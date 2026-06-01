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

  function makeUniqueStarId(text) {
    return `${getKey()}_${text}`;
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
    dock.appendChild(collapsed);
    dock.appendChild(expanded);
    document.body.appendChild(dock);

    document.body.addEventListener('click', () => {
      closeHeaderDropdown();
      closeRowDropdown();
    });

    renderPromptList();
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
    }

    const dropdown = document.createElement('div');
    dropdown.id = 'dock-row-dropdown';

    const printOption = document.createElement('div');
    printOption.className = 'dock-row-dropdown-item';
    printOption.innerHTML = `<span>🖨️</span> Print PDF`;
    
    printOption.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.remove();
      
      scrollToPrompt(index);
      
      const domPrompt = findInDOM(text);
      executeTargetPrint(text, index, domPrompt);
    });

    dropdown.appendChild(printOption);

    const rect = anchorButton.getBoundingClientRect();
    const dockContainer = document.querySelector('.dock-expanded');
    const dockRect = dockContainer.getBoundingClientRect();

    dropdown.style.position = 'absolute';
    dropdown.style.top = `${rect.bottom - dockRect.top + dockContainer.scrollTop + 4}px`;
    dropdown.style.left = `${rect.left - dockRect.left}px`;

    dockContainer.appendChild(dropdown);
  }

  function closeRowDropdown() {
    const dropdown = document.getElementById('dock-row-dropdown');
    if (dropdown) dropdown.remove();
  }

function executeTargetPrint(text, listIndex, promptNode) {

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

    const userRenderBlock =
      userMsgElem.closest('[data-test-render-count]');

    if (userRenderBlock) {
      let sibling = userRenderBlock.nextElementSibling;
      let guard = 0;

      while (sibling && guard < 20) {
        if (isAssistantBlock(sibling)) {
          return sibling;
        }

        if (
          sibling.querySelector?.(
            '[data-testid="user-message"]'
          )
        ) {
          break;
        }

        sibling = sibling.nextElementSibling;
        guard++;
      }
    }

    let current = userMsgElem;

    for (let depth = 0; current && depth < 10; depth++) {
      let sibling = current.nextElementSibling;
      let guard = 0;

      while (sibling && guard < 20) {
        if (isAssistantBlock(sibling)) {
          return sibling;
        }

        sibling = sibling.nextElementSibling;
        guard++;
      }

      current = current.parentElement;
    }

    return null;
  }

  function getPrimaryAnswerContainer(userMsgElem) {
    const responseBlock = findResponse(userMsgElem);

    if (!responseBlock) {
      return null;
    }

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
        const text =
          (node.innerText || node.textContent || '').trim();

        if (text.length > bestLength) {
          bestLength = text.length;
          bestNode = node;
        }
      });
    });

    return bestNode || responseBlock;
  }

  const userMessage = promptNode;

  if (!userMessage) {
    alert('Could not locate selected prompt');
    return;
  }

  const answerContainer =
    getPrimaryAnswerContainer(userMessage);

  let extractedResponseHTML =
    answerContainer?.innerHTML || '';

  if (!extractedResponseHTML.trim()) {
    extractedResponseHTML =
      '<div style="color:#666;font-style:italic;">Response could not be extracted.</div>';
  }

  const finalHTMLPayload = `
      <!DOCTYPE html>
      <html>
      <head>
          <meta charset="UTF-8">
          <title>Exported Prompt Response Pairing</title>
          <style>
              @media print {
                  @page { margin: 0.5in; size: A4; }
                  body {
                    -webkit-print-color-adjust: exact !important;
                    print-color-adjust: exact !important;
                  }
              }

              body {
                  font-family:-apple-system,BlinkMacSystemFont,
                  'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
                  line-height:1.6;
                  color:#333;
                  padding:30px;
                  background:#fff;
              }

              .qa-section {
                  background:#fff;
                  border:1px solid #e9ecef;
                  border-radius:8px;
                  padding:25px;
              }

              .section-label {
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    margin-bottom: 10px;
}

.prompt-label {
    color: #d97757;
}

.answer-label {
    color: #d97757;
    margin-top: 32px;
}

.question-content {
    background: #fdf7f4;
    border: 1px solid #f0d9cf;
    border-radius: 12px;
    padding: 18px;
    white-space: pre-wrap;
    font-size: 15px;
    line-height: 1.6;
    margin-bottom: 24px;
}

              .answer-content {
    margin-top:0;
    font-size:15px;
    line-height:1.75;
}

              pre {
                  background:#f8f9fa !important;
                  border:1px solid #e9ecef !important;
                  border-radius:6px !important;
                  padding:16px !important;
                  overflow:auto !important;
              }

              table {
                  border-collapse:collapse;
                  width:100%;
              }

              th, td {
                  border:1px solid #ddd;
                  padding:10px;
              }
          </style>
      </head>
      <body>
         <div class="qa-section">

    <div class="section-label prompt-label">
        Prompt
    </div>

    <div class="question-content">
        ${text.replace(/</g,'&lt;').replace(/>/g,'&gt;')}
    </div>

    <div class="section-label answer-label">
        Answer
    </div>

    <div class="answer-content">
        ${extractedResponseHTML}
    </div>

</div>
      </body>
      </html>
  `;

  const compilationFrame =
    document.createElement('iframe');

  compilationFrame.style.position = 'absolute';
  compilationFrame.style.left = '-9999px';
  compilationFrame.style.top = '-9999px';

  document.body.appendChild(compilationFrame);

  const doc =
    compilationFrame.contentDocument ||
    compilationFrame.contentWindow.document;

  doc.open();
  doc.write(finalHTMLPayload);
  doc.close();

  setTimeout(() => {
    compilationFrame.contentWindow.focus();
    compilationFrame.contentWindow.print();

    setTimeout(() => {
      compilationFrame.remove();
    }, 1500);
  }, 800);
}

  function toggleFavoritesFilter(forceState) {
    const dock = document.getElementById('prompt-dock');
    const expandedPanel = document.querySelector('.dock-expanded');
    
    if (dock) dock.classList.add('is-filtering');

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
    
    if (isFavoritesFilterActive) {
      if (headerTitle) headerTitle.textContent = 'Favourites';
      if (backBtn) backBtn.classList.add('visible');
      if (headerMenuBtn) headerMenuBtn.classList.add('hidden'); 
    } else {
      if (headerTitle) headerTitle.textContent = 'Your prompts';
      if (backBtn) backBtn.classList.remove('visible');
      if (headerMenuBtn) headerMenuBtn.classList.remove('hidden');
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

    const uniqueStarId = makeUniqueStarId(text);
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
      toggleStarStatus(text, starBtn, item);
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
    textEl.textContent = text;

    item.appendChild(metaCol);
    item.appendChild(textEl);
    
    item.addEventListener('click', () => scrollToPrompt(index));
    item.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') scrollToPrompt(index);
    });

    return item;
  }

  function toggleStarStatus(text, starBtnNode, rowNode) {
    const uniqueStarId = makeUniqueStarId(text);
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
    if (isFavoritesFilterActive) return; 
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

    const countBadge = document.querySelector('.dock-count-badge');
    const list = document.createElement('div');
    list.id = 'dock-prompt-list';

    let itemsToRender = [];
    prompts.forEach((text, i) => {
      const uniqueStarId = makeUniqueStarId(text);
      const isStarred = starredPrompts.includes(uniqueStarId);
      if (!isFavoritesFilterActive || isStarred) {
        itemsToRender.push({ text, originalIndex: i });
      }
    });

    if (countBadge) {
      countBadge.textContent = itemsToRender.length;
    }

    if (itemsToRender.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'dock-scroll-hint';
      empty.textContent = isFavoritesFilterActive ? 'No starred prompts yet' : 'No prompts yet';
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
  }

  function highlight(el) {
    el.style.transition = 'background 0.3s ease';
    el.style.background = 'rgba(218, 119, 86, 0.16)';
    el.style.borderRadius = '8px';
    setTimeout(() => { if (el) el.style.background = ''; }, 1200);
  }

  function findInDOM(text) {
    return getPromptElements().find(el => activeConfig.getLabel(el) === text) || null;
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
      const el = findInDOM(text);
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

    const domEl = findInDOM(text);
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