(function () {
  if (document.getElementById('prompt-dock')) return;

  const PLATFORM_ENGINES = {
    claude: {
      selectors: { userMessage: '[data-testid="user-message"]', mainContent: '#main-content' },
      getLabel(msg) { return (msg?.textContent || '').replace(/\s+/g, ' ').trim(); }
    }
  };

  const NUM_LINES = 8;
  let prompts = [];
  let starredPrompts = [];
  let activeIndex = -1;
  let isFavoritesFilterActive = false;
  let isSearchActive = false;
  let searchQuery = "";
  let observer = null;
  let debounceTimer = null;
  let platformKey = null;
  let activeConfig = null;
  let currentPath = location.pathname;

  function detectPlatform() {
    const href = window.location.href;
    if (/claude\.ai/i.test(href)) platformKey = "claude";
    else platformKey = null;

    activeConfig = PLATFORM_ENGINES[platformKey] || null;
  }

  function getKey() { return `dock_${platformKey || 'default'}_${location.pathname}`; }
  function getStarredKey() { return `dock_${platformKey || 'default'}_starred_global`; }

  function makeUniqueStarId(index) {
    return `${getKey()}_row_${index}`;
  }

  function loadFromStorage(cb) {
    const k = getKey();
    const sk = getStarredKey();
    chrome.storage.local.get([k, sk], (result) => {
      cb(result[k] || [], result[sk] || []);
    });
  }

  function saveToStorage(data) {
    chrome.storage.local.set({ [getKey()]: data });
  }

  function saveStarredToStorage(data) {
    chrome.storage.local.set({ [getStarredKey()]: data });
  }

  function updateActiveState() {
    detectPlatform();
    const dock = document.getElementById('prompt-dock');
    if (!activeConfig) {
      if (dock) dock.remove();
      if (observer) observer.disconnect();
      return false;
    }
    return true;
  }

  function getPromptElements() {
    if (!activeConfig) return [];
    return Array.from(document.querySelectorAll(activeConfig.selectors.userMessage));
  }

  function buildDock() {
    const existing = document.getElementById('prompt-dock');
    if (existing) existing.remove();

    const dock = document.createElement('div');
    dock.id = 'prompt-dock';
    dock.classList.add(`on-${platformKey}`);

    const collapsed = document.createElement('div');
    collapsed.className = 'dock-collapsed';
    for (let i = 0; i < NUM_LINES; i++) {
      const line = document.createElement('div');
      line.className = `dock-line dock-line-${i}`;
      collapsed.appendChild(line);
    }

    const expanded = document.createElement('div');
    expanded.className = 'dock-expanded';

    const header = document.createElement('div');
    header.className = 'dock-expanded-header';

    const titleGroup = document.createElement('div');
    titleGroup.className = 'dock-header-title-group';

    const backBtn = document.createElement('button');
    backBtn.id = 'dock-back-btn';
    backBtn.innerHTML = '←';
    backBtn.title = 'Back to prompts';
    backBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFavoritesFilter(false);
    });
    titleGroup.appendChild(backBtn);

    const headerLabel = document.createElement('span');
    headerLabel.id = 'dock-header-title';
    headerLabel.textContent = 'Your prompts';
    titleGroup.appendChild(headerLabel);
    header.appendChild(titleGroup);

    const actionsWrapper = document.createElement('div');
    actionsWrapper.className = 'dock-header-actions';

    const searchToggleBtn = document.createElement('button');
    searchToggleBtn.className = 'dock-header-search-btn';
    searchToggleBtn.innerHTML = '🔍';
    searchToggleBtn.title = 'Search prompts';
    searchToggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleSearchWindow(true);
    });
    actionsWrapper.appendChild(searchToggleBtn);

    const headerMenuBtn = document.createElement('button');
    headerMenuBtn.className = 'dock-header-menu-btn';
    headerMenuBtn.innerHTML = '•••';
    headerMenuBtn.title = 'Options';
    headerMenuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleHeaderDropdown();
    });
    actionsWrapper.appendChild(headerMenuBtn);

    const countBadge = document.createElement('span');
    countBadge.className = 'dock-count-badge';
    countBadge.textContent = '0';
    actionsWrapper.appendChild(countBadge);

    header.appendChild(actionsWrapper);
    expanded.appendChild(header);

    const searchWindow = document.createElement('div');
    searchWindow.id = 'dock-search-window';
    searchWindow.className = 'dock-search-window';

    const searchHeader = document.createElement('div');
    searchHeader.className = 'dock-search-header';

    const searchBackBtn = document.createElement('button');
    searchBackBtn.className = 'dock-search-back-btn';
    searchBackBtn.innerHTML = '←';
    searchBackBtn.title = 'Close search';
    searchBackBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleSearchWindow(false);
    });

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'dock-search-input';
    searchInput.placeholder = 'Search your prompts...';
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value.trim();
      renderPromptList();
    });

    searchHeader.appendChild(searchBackBtn);
    searchHeader.appendChild(searchInput);
    searchWindow.appendChild(searchHeader);
    expanded.appendChild(searchWindow);

    dock.appendChild(collapsed);
    dock.appendChild(expanded);
    document.body.appendChild(dock);

    document.body.addEventListener('click', () => {
      closeHeaderDropdown();
      closeRowDropdown();
    });

    renderPromptList();
  }

  function toggleSearchWindow(activate) {
    isSearchActive = activate;
    const dockContainer = document.getElementById('prompt-dock');
    const searchWindow = document.getElementById('dock-search-window');
    const searchInput = searchWindow?.querySelector('.dock-search-input');

    if (searchWindow) {
      if (activate) {
        dockContainer?.classList.add('search-active-mode');
        searchWindow.classList.add('visible');
        setTimeout(() => searchInput?.focus(), 150);
      } else {
        dockContainer?.classList.remove('search-active-mode');
        searchWindow.classList.remove('visible');
        if (searchInput) searchInput.value = "";
        searchQuery = "";
        renderPromptList();
      }
    }
  }

  function toggleHeaderDropdown() {
    closeRowDropdown();
    let dropdown = document.getElementById('dock-header-dropdown');
    if (dropdown) {
      dropdown.remove();
      return;
    }

    dropdown = document.createElement('div');
    dropdown.id = 'dock-header-dropdown';

    const favOption = document.createElement('div');
    favOption.className = 'dock-dropdown-item' + (isFavoritesFilterActive ? ' selected' : '');
    favOption.innerHTML = `<span>★</span> Favourites`;

    favOption.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.remove();
      toggleFavoritesFilter(true);
    });

    dropdown.appendChild(favOption);
    document.querySelector('.dock-expanded').appendChild(dropdown);
  }

  function closeHeaderDropdown() {
    const dropdown = document.getElementById('dock-header-dropdown');
    if (dropdown) dropdown.remove();
  }

function toggleRowDropdown(anchorButton, text, index) {
    closeHeaderDropdown();
    let existingDropdown = document.getElementById('dock-row-dropdown');
    if (existingDropdown) {
      existingDropdown.remove();
      // If clicking the same button twice, toggle it closed
      if (existingDropdown.dataset.anchorIndex == index) return;
    }

    const dropdown = document.createElement('div');
    dropdown.id = 'dock-row-dropdown';
    dropdown.dataset.anchorIndex = index; // Track which row opened it

    const printOption = document.createElement('div');
    printOption.className = 'dock-row-dropdown-item';
    printOption.innerHTML = `Print PDF`;
    
    printOption.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.remove();
      
      scrollToPrompt(index);
      
      const domPrompt = findInDOM(text, index);
      executeTargetPrint(text, index, domPrompt);
    });

    dropdown.appendChild(printOption);

    // Find the current parent row item to anchor the menu cleanly
    const parentRow = anchorButton.closest('.dock-prompt-item');
    const dockContainer = document.querySelector('.dock-expanded');

    if (parentRow && dockContainer) {
      dropdown.style.position = 'absolute';
      
      // Calculate top relative to the parent row container, fully ignoring scroll metrics bugs
      const offsetTop = parentRow.offsetTop + anchorButton.offsetTop + anchorButton.offsetHeight;
      dropdown.style.top = `${offsetTop + 4}px`;
      
      // Keep it cleanly aligned under the dots column context 
      dropdown.style.left = `16px`; 
      
      dockContainer.appendChild(dropdown);
    }
  }

  function closeRowDropdown() {
    const dropdown = document.getElementById('dock-row-dropdown');
    if (dropdown) dropdown.remove();
  }

  function isAssistantBlock(el) {
    if (!el) return false;
    return !!(
      el.querySelector?.('[data-testid="assistant-message"]') ||
      el.querySelector?.('.standard-markdown') ||
      el.querySelector?.('.font-claude-message') ||
      el.querySelector?.('.prose')
    );
  }

  function findResponse(userMsgElem) {
    if (!userMsgElem) return null;
    const userRenderBlock = userMsgElem.closest('[data-test-render-count]');
    if (userRenderBlock) {
      let sibling = userRenderBlock.nextElementSibling;
      let guard = 0;
      while (sibling && guard < 20) {
        if (isAssistantBlock(sibling)) return sibling;
        if (sibling.querySelector?.('[data-testid="user-message"]')) break;
        sibling = sibling.nextElementSibling;
        guard++;
      }
    }
    let current = userMsgElem;
    for (let depth = 0; current && depth < 10; depth++) {
      let sibling = current.nextElementSibling;
      let guard = 0;
      while (sibling && guard < 20) {
        if (isAssistantBlock(sibling)) return sibling;
        sibling = sibling.nextElementSibling;
        guard++;
      }
      current = current.parentElement;
    }
    return null;
  }

  function getPrimaryAnswerContainer(userMsgElem) {
    const responseBlock = findResponse(userMsgElem);
    if (!responseBlock) return null;
    const selectors = [
      '[data-testid="assistant-message"] .standard-markdown',
      '[data-testid="assistant-message"] .font-claude-message',
      '[data-testid="assistant-message"] .prose',
      '.standard-markdown',
      '.font-claude-message',
      '.prose'
    ];
    let bestNode = null;
    let bestLength = 0;
    selectors.forEach(selector => {
      responseBlock.querySelectorAll(selector).forEach(node => {
        const text = (node.innerText || node.textContent || '').trim();
        if (text.length > bestLength) {
          bestLength = text.length;
          bestNode = node;
        }
      });
    });
    return bestNode || responseBlock;
  }

  const SHARED_PRINT_STYLES = `
    @media print {
        @page { margin: 0; size: A4; }
        body {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
            background: #fbfaf7 !important;
            padding: 0 0.6in 0.6in !important; 
        }
        .print-page-packet {
            page-break-inside: avoid !important;
            page-break-after: always !important;
        }
        .print-page-packet:last-child {
            page-break-after: avoid !important;
        }
        pre, code, table, tr, img {
            page-break-inside: avoid !important;
        }
    }

    body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        line-height: 1.55;
        color: #191919;
        padding: 40px max(24px, calc((100% - 660px) / 2));
        background: #fbfaf7;
        word-wrap: break-word;
    }

    .print-top-head-spacer {
        height: 0.6in;
        display: block;
        width: 100%;
    }

    .qa-container {
        display: flex;
        flex-direction: column;
        gap: 32px;
        width: 100%;
        margin-bottom: 40px;
    }

    .section-label {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 10.5px;
        font-weight: 700;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        margin-bottom: 10px;
        color: #cc6644;
        user-select: none;
    }

    .question-block {
        background: #f3f0ea;
        border-radius: 10px;
        padding: 16px 20px;
        white-space: pre-wrap;
        font-size: 14px;
        line-height: 1.5;
        color: #222222;
        border: 1px solid #e6e2da;
        box-sizing: border-box;
        width: 100%;
    }

    .answer-block {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Georgia, Cambria, serif;
        font-size: 14.5px;
        color: #191919;
        line-height: 1.6;
        width: 100%;
    }

    p { margin: 0 0 12px 0; }
    p:last-child { margin-bottom: 0; }
    
    h1, h2, h3, h4 {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        color: #111111;
        font-weight: 600;
        margin: 24px 0 10px 0;
        line-height: 1.3;
    }
    h1 { font-size: 19px; }
    h2 { font-size: 17px; border-bottom: 1px solid #e6e2da; padding-bottom: 4px; }
    h3 { font-size: 15px; }

    pre {
        background: #f0ece3 !important;
        border: 1px solid #e1dbcf !important;
        border-radius: 6px !important;
        padding: 14px 18px !important;
        overflow-x: auto !important;
        margin: 16px 0 !important;
        box-sizing: border-box;
        width: 100%;
        white-space: pre-wrap !important;
        word-wrap: break-word !important;
    }

    code {
        font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, Courier, monospace !important;
        font-size: 12.5px !important;
        background: #f0ece3;
        color: #111111;
        padding: 2px 4px;
        border-radius: 4px;
        word-break: break-word !important;
    }

    pre code {
        background: transparent !important;
        padding: 0 !important;
        border-radius: 0 !important;
        font-size: 12px !important;
        color: #222222 !important;
        white-space: pre-wrap !important;
    }

    ul, ol { margin: 0 0 12px 0; padding-left: 20px; }
    li { margin-bottom: 4px; }

    table {
        border-collapse: collapse;
        width: 100% !important;
        margin: 20px 0;
        font-size: 13.5px;
        background: #ffffff;
        border-radius: 6px;
        border: 1px solid #e6e2da;
        box-sizing: border-box;
    }

    th, td {
        padding: 10px 14px;
        text-align: left;
        border-bottom: 1px solid #e6e2da;
        word-break: break-word;
    }

    th {
        background: #f3f0ea;
        font-weight: 600;
        color: #222222;
    }

    tr:last-child td { border-bottom: none; }

    button, .sr-only, [class*="feedback-"], [class*="controls-"], .heading-actions, [class*="contents-"] button {
        display: none !important;
    }
  `;

  function executeTargetPrint(text, listIndex, promptNode) {
    const userMessage = promptNode;
    if (!userMessage) {
      alert('Could not locate selected prompt in page flow.');
      return;
    }

    const answerContainer = getPrimaryAnswerContainer(userMessage);
    let extractedResponseHTML = answerContainer?.innerHTML || '';

    if (!extractedResponseHTML.trim()) {
      extractedResponseHTML = '<div style="color:#b3a190;font-style:italic;">Response could not be extracted from active layout context.</div>';
    }

    const finalHTMLPayload = `
      <!DOCTYPE html>
      <html>
      <head>
          <meta charset="UTF-8">
          <title>Exported Conversation Element</title>
          <style>${SHARED_PRINT_STYLES}</style>
      </head>
      <body>
         <div class="print-top-head-spacer"></div>
         <div class="qa-container">
            <div>
                <div class="section-label">Prompt</div>
                <div class="question-block">${text.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
            </div>
            <div>
                <div class="section-label">Response</div>
                <div class="answer-block">${extractedResponseHTML}</div>
            </div>
         </div>
      </body>
      </html>
    `;

    const compilationFrame = document.createElement('iframe');
    compilationFrame.style.position = 'absolute';
    compilationFrame.style.left = '-9999px';
    compilationFrame.style.top = '-9999px';
    document.body.appendChild(compilationFrame);

    const doc = compilationFrame.contentDocument || compilationFrame.contentWindow.document;
    doc.open();
    doc.write(finalHTMLPayload);
    doc.close();

    setTimeout(() => {
      compilationFrame.contentWindow.focus();
      compilationFrame.contentWindow.print();
      setTimeout(() => { compilationFrame.remove(); }, 1500);
    }, 800);
  }

  function executePrintAllStarred() {
    let globalPacketsHTML = "";

    prompts.forEach((text, i) => {
      const uniqueStarId = makeUniqueStarId(i);
      if (starredPrompts.includes(uniqueStarId)) {
        const domPromptNode = findInDOM(text, i);
        let responseHTML = '<div style="color:#b3a190;font-style:italic;">Response data layer virtualized. Scroll to this prompt on screen to cache content.</div>';

        if (domPromptNode) {
          const answerContainer = getPrimaryAnswerContainer(domPromptNode);
          if (answerContainer && answerContainer.innerHTML?.trim()) {
            responseHTML = answerContainer.innerHTML;
          }
        }

        globalPacketsHTML += `
          <div class="print-page-packet">
             <div class="print-top-head-spacer"></div>
             <div class="qa-container">
                <div>
                    <div class="section-label">Prompt ${i + 1}</div>
                    <div class="question-block">${text.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
                </div>
                <div>
                    <div class="section-label">Response</div>
                    <div class="answer-block">${responseHTML}</div>
                </div>
             </div>
          </div>
        `;
      }
    });

    if (!globalPacketsHTML) {
      alert("No printable saved content packages mapped in active dashboard scope.");
      return;
    }

    const finalHTMLPayload = `
      <!DOCTYPE html>
      <html>
      <head>
          <meta charset="UTF-8">
          <title>Exported Starred Prompts Compilation</title>
          <style>${SHARED_PRINT_STYLES}</style>
      </head>
      <body>
         ${globalPacketsHTML}
      </body>
      </html>
    `;

    const compilationFrame = document.createElement('iframe');
    compilationFrame.style.position = 'absolute';
    compilationFrame.style.left = '-9999px';
    compilationFrame.style.top = '-9999px';
    document.body.appendChild(compilationFrame);

    const doc = compilationFrame.contentDocument || compilationFrame.contentWindow.document;
    doc.open();
    doc.write(finalHTMLPayload);
    doc.close();

    setTimeout(() => {
      compilationFrame.contentWindow.focus();
      compilationFrame.contentWindow.print();
      setTimeout(() => { compilationFrame.remove(); }, 1500);
    }, 800);
  }

  function executePrintOnlyResponses() {
    let responsesOnlyHTML = "";
    let continuousIndex = 1;

    prompts.forEach((text, i) => {
      const uniqueStarId = makeUniqueStarId(i);
      if (starredPrompts.includes(uniqueStarId)) {
        const domPromptNode = findInDOM(text, i);
        let responseHTML = '<div style="color:#b3a190;font-style:italic;">Response text loading or unavailable...</div>';

        if (domPromptNode) {
          const answerContainer = getPrimaryAnswerContainer(domPromptNode);
          if (answerContainer && answerContainer.innerHTML?.trim()) {
            responseHTML = answerContainer.innerHTML;
          }
        }

        responsesOnlyHTML += `
          <div class="print-page-packet">
             <div class="print-top-head-spacer"></div>
             <div class="qa-container">
                <div>
                    <div class="section-label">Response ${continuousIndex}</div>
                    <div class="answer-block" style="margin-top: 12px;">
                        ${responseHTML}
                    </div>
                </div>
             </div>
          </div>
        `;
        continuousIndex++;
      }
    });

    if (!responsesOnlyHTML) {
      alert("No printable saved responses mapped in active dashboard scope.");
      return;
    }

    const finalHTMLPayload = `
      <!DOCTYPE html>
      <html>
      <head>
          <meta charset="UTF-8">
          <title>Exported Responses Only Compilation</title>
          <style>${SHARED_PRINT_STYLES}</style>
      </head>
      <body>
         ${responsesOnlyHTML}
      </body>
      </html>
    `;

    const compilationFrame = document.createElement('iframe');
    compilationFrame.style.position = 'absolute';
    compilationFrame.style.left = '-9999px';
    compilationFrame.style.top = '-9999px';
    document.body.appendChild(compilationFrame);

    const doc = compilationFrame.contentDocument || compilationFrame.contentWindow.document;
    doc.open();
    doc.write(finalHTMLPayload);
    doc.close();

    setTimeout(() => {
      compilationFrame.contentWindow.focus();
      compilationFrame.contentWindow.print();
      setTimeout(() => { compilationFrame.remove(); }, 1500);
    }, 800);
  }

  function toggleFavoritesFilter(forceState) {
    const dock = document.getElementById('prompt-dock');
    const expandedPanel = document.querySelector('.dock-expanded');

    if (dock) {
      dock.classList.add('is-filtering');
      if (forceState) {
        dock.classList.add('favorites-view-active');
      } else {
        dock.classList.remove('favorites-view-active');
      }
    }

    if (forceState && expandedPanel) {
      const currentHeight = expandedPanel.offsetHeight;
      if (currentHeight > 0) {
        expandedPanel.style.minHeight = `${currentHeight}px`;
      }
    } else if (!forceState && expandedPanel) {
      expandedPanel.style.minHeight = '';
    }

    isFavoritesFilterActive = forceState;

    const headerTitle = document.getElementById('dock-header-title');
    const backBtn = document.getElementById('dock-back-btn');
    const headerMenuBtn = document.querySelector('.dock-header-menu-btn');
    const searchToggleBtn = document.querySelector('.dock-header-search-btn');

    if (isFavoritesFilterActive) {
      if (headerTitle) headerTitle.textContent = 'Favourites';
      if (backBtn) backBtn.classList.add('visible');
      if (headerMenuBtn) headerMenuBtn.classList.add('hidden');
      if (searchToggleBtn) searchToggleBtn.classList.add('hidden');
    } else {
      if (headerTitle) headerTitle.textContent = 'Your prompts';
      if (backBtn) backBtn.classList.remove('visible');
      if (headerMenuBtn) headerMenuBtn.classList.remove('hidden');
      if (searchToggleBtn) searchToggleBtn.classList.remove('hidden');
    }

    renderPromptList();

    setTimeout(() => {
      if (dock) dock.classList.remove('is-filtering');
    }, 350);
  }

  function createPromptRowElement(text, index) {
    const item = document.createElement('div');
    item.className = 'dock-prompt-item' + (index === activeIndex ? ' active' : '');
    item.setAttribute('role', 'button');
    item.setAttribute('tabindex', '0');
    item.setAttribute('data-index', index);

    const uniqueStarId = makeUniqueStarId(index);
    const isStarred = starredPrompts.includes(uniqueStarId);
    if (isStarred) {
      item.classList.add('is-starred-row');
    }

    const metaCol = document.createElement('div');
    metaCol.className = 'dock-meta-column';

    const num = document.createElement('div');
    num.className = 'dock-prompt-num';
    num.textContent = `${index + 1}`;
    metaCol.appendChild(num);

    const actionTray = document.createElement('div');
    actionTray.className = 'dock-action-tray';

    const starBtn = document.createElement('button');
    starBtn.className = 'dock-star-btn';
    if (isStarred) starBtn.classList.add('starred');
    starBtn.innerHTML = isStarred ? '★' : '☆';

    starBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleStarStatus(index, starBtn, item);
    });

    const moreBtn = document.createElement('button');
    moreBtn.className = 'dock-more-btn';
    moreBtn.innerHTML = '•••';

    moreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleRowDropdown(moreBtn, text, index);
    });

    actionTray.appendChild(starBtn);
    actionTray.appendChild(moreBtn);
    metaCol.appendChild(actionTray);

    const textEl = document.createElement('div');
    textEl.className = 'dock-prompt-text';

    if (searchQuery && text.toLowerCase().includes(searchQuery.toLowerCase())) {
      const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`(${escapeRegex(searchQuery)})`, 'gi');
      textEl.innerHTML = text.replace(regex, '<mark class="dock-search-highlight">$1</mark>');
    } else {
      textEl.textContent = text;
    }

    item.appendChild(metaCol);
    item.appendChild(textEl);

    item.addEventListener('click', () => scrollToPrompt(index));
    item.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') scrollToPrompt(index);
    });

    return item;
  }

  function toggleStarStatus(index, starBtnNode, rowNode) {
    const uniqueStarId = makeUniqueStarId(index);
    const starIdx = starredPrompts.indexOf(uniqueStarId);

    if (starIdx > -1) {
      starredPrompts.splice(starIdx, 1);
      starBtnNode.classList.remove('starred');
      starBtnNode.innerHTML = '☆';
      rowNode.classList.remove('is-starred-row');

      if (isFavoritesFilterActive) {
        setTimeout(renderPromptList, 100);
      }
    } else {
      starredPrompts.push(uniqueStarId);
      starBtnNode.classList.add('starred');
      starBtnNode.innerHTML = '★';
      rowNode.classList.add('is-starred-row');
    }
    saveStarredToStorage(starredPrompts);
  }

  function snapDockToBottom() {
    if (isFavoritesFilterActive || isSearchActive) return;
    const promptList = document.getElementById('dock-prompt-list');
    if (promptList && promptList.scrollHeight > 0) {
      setTimeout(() => {
        promptList.scrollTop = promptList.scrollHeight;
      }, 50);
    }
  }

  function renderPromptList() {
    const expanded = document.querySelector('.dock-expanded');
    if (!expanded) return;

    const existingList = document.getElementById('dock-prompt-list');
    if (existingList) existingList.remove();

    const existingFooterAction = document.getElementById('dock-favorites-footer-bar');
    if (existingFooterAction) existingFooterAction.remove();

    const countBadge = document.querySelector('.dock-count-badge');
    const list = document.createElement('div');
    list.id = 'dock-prompt-list';

    let itemsToRender = [];
    let absoluteStarredCount = 0;

    prompts.forEach((text, i) => {
      const uniqueStarId = makeUniqueStarId(i);
      const isStarred = starredPrompts.includes(uniqueStarId);
      if (isStarred) absoluteStarredCount++;

      const passFavorites = !isFavoritesFilterActive || isStarred;
      const passSearch = !searchQuery || text.toLowerCase().includes(searchQuery.toLowerCase());

      if (passFavorites && passSearch) {
        itemsToRender.push({ text, originalIndex: i });
      }
    });

    if (countBadge) {
      countBadge.textContent = itemsToRender.length;
    }

    if (itemsToRender.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'dock-scroll-hint';
      empty.textContent = searchQuery ? 'No matches found' : (isFavoritesFilterActive ? 'No starred prompts yet' : 'No prompts yet');
      list.appendChild(empty);
    } else {
      itemsToRender.forEach((item) => {
        list.appendChild(createPromptRowElement(item.text, item.originalIndex));
      });

      if (itemsToRender.length > 6) {
        const hint = document.createElement('div');
        hint.className = 'dock-scroll-hint';
        hint.textContent = 'scroll for more';
        list.appendChild(hint);
      }
    }

    expanded.appendChild(list);

    if (isFavoritesFilterActive && absoluteStarredCount > 0) {
      const footerBar = document.createElement('div');
      footerBar.id = 'dock-favorites-footer-bar';
      footerBar.className = 'dock-favorites-footer-bar';

      const printAllBtn = document.createElement('button');
      printAllBtn.className = 'dock-print-all-favourites-btn';
      printAllBtn.innerHTML = 'Print All Favourites';
      printAllBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        printAllBtn.classList.add('is-printing-active');
        executePrintAllStarred();
        setTimeout(() => printAllBtn.classList.remove('is-printing-active'), 1200);
      });

      const printResponsesOnlyLink = document.createElement('div');
      printResponsesOnlyLink.className = 'dock-print-responses-only-link';
      printResponsesOnlyLink.innerHTML = 'print without prompts';
      printResponsesOnlyLink.addEventListener('click', (e) => {
        e.stopPropagation();
        printResponsesOnlyLink.classList.add('is-active-link');
        executePrintOnlyResponses();
        setTimeout(() => printResponsesOnlyLink.classList.remove('is-active-link'), 1200);
      });

      footerBar.appendChild(printAllBtn);
      footerBar.appendChild(printResponsesOnlyLink);
      expanded.appendChild(footerBar);
    }
  }

  function findInDOM(text, index) {
    const allPromptsOnScreen = getPromptElements();
    if (allPromptsOnScreen[index] && activeConfig.getLabel(allPromptsOnScreen[index]) === text) {
      return allPromptsOnScreen[index];
    }
    return allPromptsOnScreen.find(el => activeConfig.getLabel(el) === text) || null;
  }

  function getScroller() {
    if (activeConfig?.selectors?.mainContent) {
      const targetScroller = document.querySelector(activeConfig.selectors.mainContent);
      if (targetScroller) return targetScroller;
    }
    const els = Array.from(document.querySelectorAll('div[class*="overflow-y-auto"]'));
    if (!els.length) return document.documentElement;
    return els.reduce((best, el) => el.scrollHeight > best.scrollHeight ? el : best, document.documentElement);
  }

  function scrollUntilFound(text, index) {
    const scroller = getScroller();
    const isTopHalf = index < prompts.length / 2;
    const scrollStep = isTopHalf ? -1800 : 1800;

    function step() {
      const el = findInDOM(text, index);
      if (el) {
        stabilizeTargetScroll(el);
      } else {
        const prevTop = scroller.scrollTop;
        scroller.scrollTop += scrollStep;
        if (scroller.scrollTop !== prevTop && scroller.scrollTop > 0 && scroller.scrollTop < (scroller.scrollHeight - scroller.clientHeight)) {
          requestAnimationFrame(step);
        }
      }
    }
    requestAnimationFrame(step);
  }

  function stabilizeTargetScroll(element) {
    if (!element) return;
    element.scrollIntoView({ behavior: 'auto', block: 'center' });

    const checkDelayTimestamps = [50, 150, 300, 550, 800];
    checkDelayTimestamps.forEach((delay) => {
      setTimeout(() => {
        if (!element) return;
        const scroller = getScroller();
        const scrollerRect = scroller === document.documentElement ? { top: 0, height: window.innerHeight } : scroller.getBoundingClientRect();
        const elementRect = element.getBoundingClientRect();
        const currentElementCenter = elementRect.top + (elementRect.height / 2);
        const targetScrollerCenter = scrollerRect.top + (scrollerRect.height / 2);
        const errorOffset = currentElementCenter - targetScrollerCenter;

        if (Math.abs(errorOffset) > 2) {
          scroller.scrollTop += errorOffset;
        }
        if (delay === 800) {
          highlight(element);
        }
      }, delay);
    });
  }

  function scrollToPrompt(index) {
    const text = prompts[index];
    if (!text) return;

    activeIndex = index;

    document.querySelectorAll('.dock-prompt-item.active').forEach(item => {
      item.classList.remove('active');
    });

    const targetRow = document.querySelector(`.dock-prompt-item[data-index="${index}"]`);
    if (targetRow) {
      targetRow.classList.add('active');
    }

    const domEl = findInDOM(text, index);
    if (domEl) {
      stabilizeTargetScroll(domEl);
    } else {
      scrollUntilFound(text, index);
    }
  }

  function refresh() {
    if (!activeConfig) return;

    const domPrompts = Array.from(document.querySelectorAll(activeConfig.selectors.userMessage))
      .map(el => activeConfig.getLabel(el))
      .filter(t => t.length > 0);

    if (domPrompts.length === 0) return;
    if (JSON.stringify(domPrompts) === JSON.stringify(prompts)) return;

    const wasNew = domPrompts.length > prompts.length;
    prompts = domPrompts;
    saveToStorage(prompts);
    renderPromptList();

    if (wasNew) {
      snapDockToBottom();
      const lines = document.querySelectorAll('.dock-line');
      lines.forEach(l => {
        l.classList.add('dock-line-new');
        setTimeout(() => l.classList.remove('dock-line-new'), 2000);
      });
    }
  }

  function startObserving() {
    if (observer) observer.disconnect();
    if (!activeConfig) return;

    const target = document.querySelector(activeConfig.selectors.mainContent) || document.body;

    observer = new MutationObserver(() => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(refresh, 250);
    });

    observer.observe(target, { childList: true, subtree: true });
  }

  setInterval(() => {
    if (location.pathname !== currentPath) {
      currentPath = location.pathname;
      prompts = [];
      activeIndex = -1;
      isFavoritesFilterActive = false;
      isSearchActive = false;
      searchQuery = "";

      if (!updateActiveState()) return;

      loadFromStorage((stored, starred) => {
        prompts = stored;
        starredPrompts = starred;
        renderPromptList();
        snapDockToBottom();
        setTimeout(() => {
          startObserving();
          refresh();
        }, 600);
      });
    }
  }, 500);

  if (updateActiveState()) {
    buildDock();
    loadFromStorage((stored, starred) => {
      prompts = stored;
      starredPrompts = starred;
      renderPromptList();
      snapDockToBottom();

      const checkContent = setInterval(() => {
        if (document.querySelectorAll(activeConfig.selectors.userMessage).length > 0) {
          clearInterval(checkContent);
          refresh();
          startObserving();
          snapDockToBottom();
        }
      }, 300);
    });
  }
})();