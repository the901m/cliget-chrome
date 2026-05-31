let selectedDownload = null;

function escapeBash(str) {
  if (!str) return "''";
  return "'" + str.replace(/'/g, "'\\''") + "'";
}

function generateCommands(download, extraArgs) {
  const url = download.finalUrl || download.url;
  const filename = download.filename || 'download';
  const headers = download.headers || [];
  const bodyData = download.bodyData;

  const eUrl = escapeBash(url);
  const eFilename = escapeBash(filename);
  const formattedExtraArgs = extraArgs ? ` ${extraArgs.trim()}` : '';

  // 1. Build Curl Command
  let curl = `curl -L`;
  headers.forEach(h => {
    const nameLower = h.name.toLowerCase();
    if (nameLower === 'user-agent') {
      curl += ` -A ${escapeBash(h.value)}`;
    } else if (nameLower === 'referer') {
      curl += ` -e ${escapeBash(h.value)}`;
    } else if (nameLower === 'cookie') {
      curl += ` -b ${escapeBash(h.value)}`;
    } else {
      curl += ` -H ${escapeBash(`${h.name}: ${h.value}`)}`;
    }
  });
  if (bodyData) {
    curl += ` --data ${escapeBash(bodyData)}`;
  }
  curl += `${formattedExtraArgs} -o ${eFilename} ${eUrl}`;

  // 2. Build Wget Command
  let wget = `wget`;
  headers.forEach(h => {
    const nameLower = h.name.toLowerCase();
    if (nameLower === 'user-agent') {
      wget += ` --user-agent ${escapeBash(h.value)}`;
    } else if (nameLower === 'referer') {
      wget += ` --referer ${escapeBash(h.value)}`;
    } else {
      wget += ` --header ${escapeBash(`${h.name}: ${h.value}`)}`;
    }
  });
  if (bodyData) {
    wget += ` --post-data ${escapeBash(bodyData)}`;
  }
  wget += `${formattedExtraArgs} --output-document ${eFilename} ${eUrl}`;

  // 3. Build Aria2 Command
  let aria2 = `aria2c`;
  headers.forEach(h => {
    const nameLower = h.name.toLowerCase();
    if (nameLower === 'user-agent') {
      aria2 += ` --user-agent ${escapeBash(h.value)}`;
    } else if (nameLower === 'referer') {
      aria2 += ` --referer ${escapeBash(h.value)}`;
    } else {
      aria2 += ` --header ${escapeBash(`${h.name}: ${h.value}`)}`;
    }
  });
  if (bodyData) {
    aria2 += ` --post-data ${escapeBash(bodyData)}`;
  }
  aria2 += `${formattedExtraArgs} --out ${eFilename} ${eUrl}`;

  return { curl, wget, aria2 };
}

function loadDownloads() {
  chrome.storage.local.get({ downloads: [] }, (data) => {
    const listContainer = document.getElementById('downloadList');
    listContainer.innerHTML = '';

    if (data.downloads.length === 0) {
      listContainer.innerHTML = '<div class="no-downloads">No downloads captured yet</div>';
      document.getElementById('detailsArea').style.display = 'none';
      return;
    }

    data.downloads.forEach((dl, index) => {
      const item = document.createElement('div');
      item.className = 'download-item';
      if (selectedDownload && selectedDownload.id === dl.id) {
        item.classList.add('selected');
        selectedDownload = dl;
      } else if (!selectedDownload && index === 0) {
        item.classList.add('selected');
        selectedDownload = dl;
      }

      item.textContent = dl.filename || dl.url;
      item.addEventListener('click', () => {
        document.querySelectorAll('.download-item').forEach(el => el.classList.remove('selected'));
        item.classList.add('selected');
        selectedDownload = dl;
        updateDetails();
      });

      listContainer.appendChild(item);
    });

    updateDetails();
  });
}

function updateDetails() {
  if (!selectedDownload) {
    document.getElementById('detailsArea').style.display = 'none';
    return;
  }

  document.getElementById('detailsArea').style.display = 'block';

  chrome.storage.local.get({ extraArgs: '' }, (settings) => {
    const cmds = generateCommands(selectedDownload, settings.extraArgs);

    document.getElementById('curlBox').value = cmds.curl;
    document.getElementById('wgetBox').value = cmds.wget;
    document.getElementById('aria2Box').value = cmds.aria2;
  });
}

function setupCopy(buttonId, boxId) {
  document.getElementById(buttonId).addEventListener('click', () => {
    const text = document.getElementById(boxId).value;
    navigator.clipboard.writeText(text).then(() => {
      const btn = document.getElementById(buttonId);
      const originalText = btn.textContent;
      btn.textContent = 'Copied!';
      btn.style.backgroundColor = '#34c759';
      btn.style.color = '#fff';
      setTimeout(() => {
        btn.textContent = originalText;
        btn.style.backgroundColor = '';
        btn.style.color = '';
      }, 1500);
    });
  });
}

setupCopy('copyCurl', 'curlBox');
setupCopy('copyWget', 'wgetBox');
setupCopy('copyAria2', 'aria2Box');

// Settings handlers
const autoCancelCheck = document.getElementById('autoCancelCheck');
chrome.storage.local.get({ autoCancel: false }, (settings) => {
  autoCancelCheck.checked = settings.autoCancel;
});

autoCancelCheck.addEventListener('change', () => {
  chrome.storage.local.set({ autoCancel: autoCancelCheck.checked });
});

const extraArgsInput = document.getElementById('extraArgsInput');
chrome.storage.local.get({ extraArgs: '' }, (settings) => {
  extraArgsInput.value = settings.extraArgs;
});

extraArgsInput.addEventListener('input', () => {
  chrome.storage.local.set({ extraArgs: extraArgsInput.value }, () => {
    updateDetails();
  });
});

// Clear list handler
document.getElementById('clearBtn').addEventListener('click', () => {
  chrome.storage.local.set({ downloads: [] }, () => {
    selectedDownload = null;
    loadDownloads();
  });
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'refresh') {
    loadDownloads();
  }
});

loadDownloads();
