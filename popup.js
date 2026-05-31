let selectedDownload = null;

function escapeBash(str) {
  if (!str) return "''";
  return "'" + str.replace(/'/g, "'\\''") + "'";
}

function generateCommands(download, extraArgs) {
  const url = download.finalUrl || download.url;
  const filename = download.filename || 'download';
  const headers = download.headers || [];

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

    document.getElementById('curlBox').textContent = cmds.curl;
    document.getElementById('wgetBox').textContent = cmds.wget;
    document.getElementById('aria2Box').textContent = cmds.aria2;
  });

  chrome.downloads.search({ id: selectedDownload.id }, (results) => {
    const actionButtons = document.querySelector('.actions');
    if (results && results[0] && results[0].state === 'in_progress') {
      actionButtons.style.display = 'flex';
    } else {
      actionButtons.style.display = 'none';
    }
  });
}

function setupCopy(buttonId, boxId) {
  document.getElementById(buttonId).addEventListener('click', () => {
    const text = document.getElementById(boxId).textContent;
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

document.getElementById('resumeBtn').addEventListener('click', () => {
  if (selectedDownload) {
    chrome.downloads.resume(selectedDownload.id, () => {
      updateDetails();
    });
  }
});

document.getElementById('cancelBtn').addEventListener('click', () => {
  if (selectedDownload) {
    chrome.downloads.cancel(selectedDownload.id, () => {
      updateDetails();
    });
  }
});

// Settings handlers
const autoPauseCheck = document.getElementById('autoPauseCheck');
chrome.storage.local.get({ autoPause: false }, (settings) => {
  autoPauseCheck.checked = settings.autoPause;
});

autoPauseCheck.addEventListener('change', () => {
  chrome.storage.local.set({ autoPause: autoPauseCheck.checked });
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
