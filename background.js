const requestHeadersMap = new Map();
const contentDispositionMap = new Map();
const requestBodyMap = new Map();

// 1. Capture POST body data (for form-submitted/login downloads)
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.method === "POST" && details.requestBody) {
      let bodyData = null;
      if (details.requestBody.formData) {
        const params = new URLSearchParams();
        for (const [key, values] of Object.entries(details.requestBody.formData)) {
          values.forEach(val => params.append(key, val));
        }
        bodyData = params.toString();
      } else if (details.requestBody.raw && details.requestBody.raw[0]) {
        try {
          const decoder = new TextDecoder("utf-8");
          bodyData = decoder.decode(details.requestBody.raw[0].bytes);
        } catch (e) {
          console.error("Failed to decode raw POST body", e);
        }
      }
      if (bodyData) {
        requestBodyMap.set(details.url, bodyData);
        if (requestBodyMap.size > 50) {
          requestBodyMap.delete(requestBodyMap.keys().next().value);
        }
      }
    }
  },
  { urls: ["<all_urls>"] },
  ["requestBody"]
);

// 2. Capture outbound request headers
chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    if (details.url.startsWith('http://') || details.url.startsWith('https://')) {
      const headers = details.requestHeaders.filter(h => {
        const name = h.name.toLowerCase();
        return ![
          'content-length', 
          'connection', 
          'keep-alive', 
          'accept-encoding', 
          'te', 
          'trailer'
        ].includes(name);
      });
      requestHeadersMap.set(details.url, headers);
      
      if (requestHeadersMap.size > 100) {
        const firstKey = requestHeadersMap.keys().next().value;
        requestHeadersMap.delete(firstKey);
      }
    }
  },
  { urls: ["<all_urls>"] },
  ["requestHeaders", "extraHeaders"]
);

// Helper to parse filename from Content-Disposition header
function getFilenameFromContentDisposition(headerValue) {
  if (!headerValue) return null;
  const utf8Match = headerValue.match(/filename\*=\s*utf-8''([^;\n]+)/i);
  if (utf8Match) {
    return decodeURIComponent(utf8Match[1]);
  }
  const normalMatch = headerValue.match(/filename=\s*["']?([^;'"\n]+)["']?/i);
  if (normalMatch) {
    return decodeURIComponent(normalMatch[1]);
  }
  return null;
}

// 3. Capture response headers to find the real filename early
chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.responseHeaders) {
      const cdHeader = details.responseHeaders.find(h => h.name.toLowerCase() === 'content-disposition');
      if (cdHeader) {
        const filename = getFilenameFromContentDisposition(cdHeader.value);
        if (filename) {
          contentDispositionMap.set(details.url, filename);
          if (contentDispositionMap.size > 100) {
            const firstKey = contentDispositionMap.keys().next().value;
            contentDispositionMap.delete(firstKey);
          }
        }
      }
    }
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders", "extraHeaders"]
);

function getFilenameFromUrl(url) {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname;
    const filename = pathname.substring(pathname.lastIndexOf('/') + 1);
    return decodeURIComponent(filename) || 'download';
  } catch (e) {
    return 'download';
  }
}

// Helper to build default browser headers if any are missing
function mergeWithDefaultHeaders(capturedHeaders, downloadItem) {
  const headerMap = new Map();
  
  if (capturedHeaders) {
    capturedHeaders.forEach(h => {
      headerMap.set(h.name.toLowerCase(), { name: h.name, value: h.value });
    });
  }

  const urlObj = new URL(downloadItem.url);
  const defaults = {
    'host': urlObj.host,
    'user-agent': navigator.userAgent,
    'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'accept-language': navigator.language || 'en-US,en;q=0.9',
    'upgrade-insecure-requests': '1',
    'sec-fetch-dest': 'document',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-site': downloadItem.referrer && new URL(downloadItem.referrer).host === urlObj.host ? 'same-origin' : 'cross-site',
    'sec-fetch-user': '?1'
  };

  if (downloadItem.referrer) {
    defaults['referer'] = downloadItem.referrer;
  }

  for (const [key, val] of Object.entries(defaults)) {
    if (!headerMap.has(key)) {
      const capitalizedName = key.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join('-');
      headerMap.set(key, { name: capitalizedName, value: val });
    }
  }

  return Array.from(headerMap.values());
}

chrome.downloads.onCreated.addListener(async (downloadItem) => {
  if (!downloadItem.url.startsWith('http://') && !downloadItem.url.startsWith('https://')) {
    return;
  }

  // Auto-cancel instead of auto-pause to immediately stop browser downloads
  chrome.storage.local.get({ autoCancel: false }, (settings) => {
    if (settings.autoCancel) {
      chrome.downloads.cancel(downloadItem.id, () => {
        if (chrome.runtime.lastError) {
          console.log("Could not cancel download:", chrome.runtime.lastError.message);
        }
      });
    }
  });

  const url = downloadItem.url;
  const finalUrl = downloadItem.finalUrl || url;

  // Retrieve headers and post body mapping
  let rawHeaders = requestHeadersMap.get(url) || requestHeadersMap.get(finalUrl) || [];
  let headers = mergeWithDefaultHeaders(rawHeaders, downloadItem);
  let bodyData = requestBodyMap.get(url) || requestBodyMap.get(finalUrl) || null;

  // Fetch fresh cookies and update the cookie header
  try {
    const cookies = await chrome.cookies.getAll({ url: finalUrl });
    if (cookies.length > 0) {
      const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
      headers = headers.filter(h => h.name.toLowerCase() !== 'cookie');
      headers.push({ name: 'Cookie', value: cookieStr });
    }
  } catch (e) {
    console.error("Error fetching cookies:", e);
  }

  // Determine correct filename
  let filename = contentDispositionMap.get(url) || contentDispositionMap.get(finalUrl);
  if (!filename && downloadItem.filename) {
    filename = downloadItem.filename.split(/[\\/]/).pop();
  }
  if (!filename || filename === 'download') {
    filename = getFilenameFromUrl(finalUrl);
  }

  const downloadData = {
    id: downloadItem.id,
    url: url,
    finalUrl: finalUrl,
    filename: filename,
    headers: headers,
    bodyData: bodyData,
    timestamp: Date.now()
  };

  chrome.storage.local.get({ downloads: [] }, (data) => {
    let list = data.downloads.filter(item => item.id !== downloadItem.id);
    list.unshift(downloadData);
    if (list.length > 10) {
      list = list.slice(0, 10);
    }
    chrome.storage.local.set({ downloads: list }, () => {
      chrome.runtime.sendMessage({ action: "refresh" }).catch(() => {});
    });
  });
});

chrome.downloads.onChanged.addListener((delta) => {
  if (delta.filename && delta.filename.current) {
    const filename = delta.filename.current.split(/[\\/]/).pop();
    chrome.storage.local.get({ downloads: [] }, (data) => {
      let list = data.downloads;
      let updated = false;
      for (let item of list) {
        if (item.id === delta.id) {
          item.filename = filename;
          updated = true;
          break;
        }
      }
      if (updated) {
        chrome.storage.local.set({ downloads: list }, () => {
          chrome.runtime.sendMessage({ action: "refresh" }).catch(() => {});
        });
      }
    });
  }
});
