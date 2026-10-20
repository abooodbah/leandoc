(function () {
  "use strict";

  var webView2Bridge = window.chrome && window.chrome.webview;
  var webKitBridge = window.webkit &&
    window.webkit.messageHandlers &&
    window.webkit.messageHandlers.leandoc;
  var Fixups = window.LeanDocFixups;
  var Wording = window.LeanDocText;
  var systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
  var root = document.documentElement;
  var elements = {
    clearRecent: document.getElementById("clearRecent"),
    docBody: document.getElementById("docBody"),
    docScroller: document.getElementById("docScroller"),
    docStyles: document.getElementById("docStyles"),
    editorButton: document.getElementById("editorButton"),
    fidelityBar: document.getElementById("fidelityBar"),
    fidelityCollapse: document.getElementById("fidelityCollapse"),
    fidelityDetails: document.getElementById("fidelityDetails"),
    fidelityEditor: document.getElementById("fidelityEditor"),
    fidelityList: document.getElementById("fidelityList"),
    fidelityText: document.getElementById("fidelityText"),
    fileMeta: document.getElementById("fileMeta"),
    fileName: document.getElementById("fileName"),
    findCount: document.getElementById("findCount"),
    findInput: document.getElementById("findInput"),
    liveStatus: document.getElementById("liveStatus"),
    openButton: document.getElementById("openButton"),
    outline: document.getElementById("outline"),
    outlineList: document.getElementById("outlineList"),
    outlineToggle: document.getElementById("outlineToggle"),
    readerPane: document.getElementById("readerPane"),
    recentList: document.getElementById("recentList"),
    recentSection: document.getElementById("recentSection"),
    stateEditorButton: document.getElementById("stateEditorButton"),
    stateEyebrow: document.getElementById("stateEyebrow"),
    stateMessage: document.getElementById("stateMessage"),
    stateOpenButton: document.getElementById("stateOpenButton"),
    statePane: document.getElementById("statePane"),
    stateTitle: document.getElementById("stateTitle"),
    status: document.getElementById("statusToast"),
    tabStrip: document.getElementById("tabStrip"),
    themeButton: document.getElementById("themeButton"),
    viewPage: document.getElementById("viewPage"),
    viewReading: document.getElementById("viewReading"),
    zoomIn: document.getElementById("zoomIn"),
    zoomOut: document.getElementById("zoomOut"),
    zoomValue: document.getElementById("zoomValue")
  };

  var EMPTY_TITLE = "Read Word documents without opening an office suite.";
  var EMPTY_MESSAGE = "Open a .docx file to read it here. LeanDoc does not run " +
    "macros or fetch anything the document points to.";
  var ZOOM_STEPS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
  var MAX_MATCHES = 5000;

  var host = { platform: "", version: "", editorKind: "", editorLabel: "", tabs: false };
  var isMac = /Mac/.test(navigator.platform || "");
  var currentTheme = "system";
  var currentView = "page";
  var tabs = [];
  var activeTabId = null;
  var focusTabAfterRender = false;
  // The document on screen, or being prepared for the screen.
  var current = null;
  var displayed = false;
  var renderSerial = 0;
  // Only the active tab's package is kept, for view switches.
  var packageCache = null;
  var blobUrls = [];
  var savedScroll = new Map();
  var collapsedBars = new Map();
  var announcedDocuments = new Set();
  var zoomMode = "auto";
  var zoomFactor = 1;
  var supportsZoom = !!(window.CSS && CSS.supports && CSS.supports("zoom", "2"));
  var outlineEntries = [];
  var currentOutlineIndex = -1;
  // The entry the reader jumped to stays current until the reader scrolls
  // (wheel, keys, pointer, touch) or the view moves more than half a screen
  // from the jump (find, a reload). Two headings close together would
  // otherwise highlight the second one right after a click on the first, and
  // pages that lay out lazily can nudge the position by themselves after a
  // jump, so an exact position cannot tell.
  var pinnedOutline = null;
  var search = { matches: [], index: -1, marks: false };
  var toastTimer = 0;
  var scrollFrame = 0;
  var resizeFrame = 0;
  var wheelTotal = 0;

  function post(message) {
    var text = JSON.stringify(message);
    try {
      if (webView2Bridge) {
        webView2Bridge.postMessage(text);
      } else if (webKitBridge) {
        webKitBridge.postMessage(text);
      }
    } catch (_error) {
      // A host that has gone away cannot be told anything.
    }
  }

  function idKey(id) {
    return id === null || id === undefined ? "" : String(id);
  }

  function sameId(left, right) {
    return idKey(left) !== "" && idKey(left) === idKey(right);
  }

  function now() {
    return window.performance && performance.now ? performance.now() : Date.now();
  }

  function modifier(event) {
    return isMac ? event.metaKey : event.ctrlKey;
  }

  function shortcut(text) {
    return isMac ? text.replace(/Ctrl\+/g, "Cmd+") : text;
  }

  function announce(message) {
    elements.liveStatus.textContent = "";
    window.setTimeout(function () {
      elements.liveStatus.textContent = message;
    }, 30);
  }

  function showStatus(message, tone) {
    window.clearTimeout(toastTimer);
    elements.status.textContent = message;
    elements.status.dataset.tone = tone === "warning" || tone === "error" ? tone : "info";
    elements.status.hidden = !message;
    toastTimer = window.setTimeout(function () {
      elements.status.hidden = true;
    }, tone === "warning" || tone === "error" ? 8000 : 5000);
  }

  function formatBytes(bytes) {
    var value = Number(bytes);
    if (!isFinite(value) || value <= 0) {
      return "";
    }
    if (value < 1024) {
      return value + " B";
    }
    if (value < 1024 * 1024) {
      return (value / 1024).toFixed(value < 10240 ? 1 : 0) + " KB";
    }
    return (value / (1024 * 1024)).toFixed(1) + " MB";
  }

  // Theme

  function applyTheme(theme) {
    currentTheme = theme === "light" || theme === "dark" ? theme : "system";
    if (currentTheme === "system") {
      root.removeAttribute("data-theme");
    } else {
      root.setAttribute("data-theme", currentTheme);
    }
    var label = currentTheme.charAt(0).toUpperCase() + currentTheme.slice(1);
    elements.themeButton.textContent = label;
    elements.themeButton.setAttribute("aria-label",
      "Theme: " + label + ". Activate to change theme.");
    elements.themeButton.title = shortcut("Theme: " + label + " (Ctrl+Shift+T)");
  }

  function cycleTheme() {
    var next = currentTheme === "system" ? "light"
      : currentTheme === "light" ? "dark" : "system";
    applyTheme(next);
    post({ type: "setTheme", theme: next });
  }

  // Host details and the editor action

  function editorLabel() {
    return host.editorLabel;
  }

  function updateEditorButtons() {
    var label = editorLabel();
    [elements.editorButton, elements.fidelityEditor, elements.stateEditorButton]
      .forEach(function (button) {
        button.textContent = label;
      });
    elements.editorButton.hidden = !label;
    elements.editorButton.title = label ? shortcut(label + " (Ctrl+Shift+E)") : "";
    elements.fidelityEditor.hidden = !label;
    var fallback = elements.statePane.dataset.state === "fallback";
    elements.stateEditorButton.hidden = !label || !fallback;
    // On a fallback page the editor is the main way forward.
    elements.stateOpenButton.className = "button " +
      (fallback && label ? "button-secondary" : "button-primary");
  }

  function updateShortcutTitles() {
    elements.openButton.title = shortcut("Open a document (Ctrl+O)");
    elements.viewPage.title = shortcut("Page view (Ctrl+Shift+V)");
    elements.viewReading.title = shortcut("Reading view (Ctrl+Shift+V)");
    elements.zoomIn.title = shortcut("Zoom in (Ctrl++)");
    elements.zoomOut.title = shortcut("Zoom out (Ctrl+-)");
    elements.findInput.title = shortcut("Find in document (Ctrl+F, F3)");
    applyTheme(currentTheme);
    updateEditorButtons();
    updateZoomLabel(effectiveZoom());
  }

  function receiveHost(data) {
    host.platform = String(data.platform || "");
    host.version = String(data.version || "");
    var editor = data.editor && typeof data.editor === "object" ? data.editor : {};
    host.editorKind = String(editor.kind || "");
    host.editorLabel = Wording.editorActionLabel(editor.label);
    host.tabs = data.tabs === true;
    isMac = host.platform === "macos" || (!host.platform && isMac);
    root.dataset.platform = host.platform;
    updateShortcutTitles();
    renderTabs();
  }

  function openInEditor() {
    var tab = current ? current.tab : activeTabId;
    post({ type: "openInEditor", tab: tab === undefined ? null : tab });
  }

  // Scroll position

  function scrollRatio() {
    var scroller = elements.docScroller;
    var available = scroller.scrollHeight - scroller.clientHeight;
    return available > 0 ? scroller.scrollTop / available : 0;
  }

  function scrollToRatio(ratio) {
    var scroller = elements.docScroller;
    var available = scroller.scrollHeight - scroller.clientHeight;
    scroller.scrollTop = Math.max(0, available * (ratio || 0));
  }

  // Empty state and fallback pages

  function clearDocument() {
    renderSerial += 1;
    packageCache = null;
    clearSearch();
    revokeBlobUrls(blobUrls);
    blobUrls = [];
    elements.docStyles.replaceChildren();
    elements.docBody.replaceChildren();
    elements.docBody.setAttribute("aria-busy", "false");
    outlineEntries = [];
    elements.outlineList.replaceChildren();
    elements.outline.hidden = true;
    elements.fidelityBar.hidden = true;
  }

  function setControlsEnabled(enabled) {
    elements.findInput.disabled = !enabled;
    elements.viewPage.disabled = !enabled;
    elements.viewReading.disabled = !enabled;
    elements.zoomIn.disabled = !enabled;
    elements.zoomOut.disabled = !enabled;
    elements.zoomValue.disabled = !enabled;
    if (enabled) {
      updateZoomLabel(effectiveZoom());
    }
  }

  function showState(kind, eyebrow, title, message) {
    if (displayed && current) {
      savedScroll.set(idKey(current.tab), scrollRatio());
    }
    displayed = false;
    elements.readerPane.hidden = true;
    elements.statePane.hidden = false;
    elements.statePane.dataset.state = kind;
    elements.stateEyebrow.textContent = eyebrow;
    elements.stateTitle.textContent = title;
    elements.stateMessage.textContent = message;
    elements.stateOpenButton.textContent = kind === "fallback"
      ? "Open another document"
      : "Open a document";
    root.removeAttribute("data-has-document");
    elements.recentSection.hidden = kind !== "empty" ||
      !elements.recentList.childElementCount;
    setControlsEnabled(false);
    updateEditorButtons();
    root.dataset.renderState = kind;
  }

  function setIdentity(name, meta, path) {
    elements.fileName.textContent = name || "LeanDoc";
    elements.fileName.title = path || "";
    elements.fileMeta.textContent = meta || "";
    document.title = name ? name + " · LeanDoc" : "LeanDoc";
  }

  function renderRecent(recent) {
    var fragment = document.createDocumentFragment();
    (Array.isArray(recent) ? recent : []).slice(0, 10).forEach(function (entry) {
      var path = entry && typeof entry.path === "string" ? entry.path : "";
      if (!path) {
        return;
      }
      var name = entry.name ? String(entry.name) : path.split(/[\\/]/).pop();
      var item = document.createElement("li");
      var button = document.createElement("button");
      button.type = "button";
      button.className = "recent-item";
      button.dataset.path = path;
      // A host may name entries by an opaque id (Linux does, so a file name
      // that is not valid UTF-8 still opens); it is posted back as given.
      if (entry.id !== undefined && entry.id !== null && String(entry.id) !== "") {
        button.dataset.recentId = String(entry.id);
      }
      button.setAttribute("aria-label", "Open " + name + ", " + path);
      var nameNode = document.createElement("span");
      nameNode.className = "recent-name";
      nameNode.textContent = name;
      var pathNode = document.createElement("span");
      pathNode.className = "recent-path";
      pathNode.textContent = path;
      button.append(nameNode, pathNode);
      item.appendChild(button);
      fragment.appendChild(item);
    });
    elements.recentList.replaceChildren(fragment);
  }

  function receiveEmpty(data) {
    clearDocument();
    current = null;
    renderRecent(data.recent);
    setIdentity("", "Word document reader", "");
    elements.fileName.textContent = "LeanDoc";
    showState("empty", "LeanDoc", EMPTY_TITLE, EMPTY_MESSAGE);
  }

  function receiveFallback(data) {
    if (displayed && current && !sameId(current.tab, data.tab)) {
      savedScroll.set(idKey(current.tab), scrollRatio());
    }
    clearDocument();
    var report = data.report && typeof data.report === "object" ? data.report : {};
    current = {
      tab: data.tab,
      generation: data.generation,
      fileName: String(data.fileName || ""),
      displayPath: String(data.displayPath || ""),
      report: report,
      fallback: true
    };
    var info = Wording.describeFallback(report);
    setIdentity(current.fileName || "Untitled", "Not shown", current.displayPath);
    showState("fallback", info.title, current.fileName || "Untitled", info.message);
    elements.statePane.dataset.code = info.code;
  }

  function showRenderFailure() {
    var name = current ? current.fileName || "Untitled" : "Untitled";
    clearDocument();
    if (current) {
      current.fallback = true;
    }
    setIdentity(name, "Not shown", current ? current.displayPath : "");
    showState("fallback", "This document could not be shown", name,
      "LeanDoc could not lay out this document.");
    elements.statePane.dataset.code = "render-failed";
    root.dataset.renderState = "failed";
  }

  // Rendering

  function renderOptions() {
    var reading = currentView === "reading";
    return {
      className: "docx",
      inWrapper: true,
      hideWrapperOnPrint: false,
      ignoreWidth: reading,
      ignoreHeight: reading,
      ignoreFonts: true,
      breakPages: !reading,
      ignoreLastRenderedPageBreak: false,
      experimental: true,
      trimXmlDeclaration: true,
      renderHeaders: !reading,
      renderFooters: !reading,
      renderFootnotes: true,
      renderEndnotes: true,
      renderComments: false,
      renderChanges: false,
      renderAltChunks: false,
      useBase64URL: false,
      keepOrigin: true,
      debug: false
    };
  }

  function fetchPackage(url) {
    var target;
    try {
      target = new URL(String(url || ""), window.location.href);
    } catch (_error) {
      return Promise.reject(new Error("The package address is not valid."));
    }
    if (target.origin !== window.location.origin) {
      return Promise.reject(new Error("The package is not on the reader's origin."));
    }
    return fetch(target.href, { cache: "no-store", credentials: "same-origin" })
      .then(function (response) {
        if (!response.ok) {
          throw new Error("The package could not be loaded (" + response.status + ").");
        }
        return response.arrayBuffer();
      });
  }

  function collectBlobUrls(nodes) {
    var found = [];
    function add(value) {
      if (typeof value === "string" && value.indexOf("blob:") === 0 &&
          found.indexOf(value) < 0) {
        found.push(value);
      }
    }
    nodes.forEach(function (node) {
      if (node.nodeName === "STYLE") {
        (node.textContent.match(/blob:[^)"'\s]+/g) || []).forEach(add);
      } else if (node.querySelectorAll) {
        node.querySelectorAll("img[src], image").forEach(function (image) {
          add(image.getAttribute("src") || image.getAttribute("href") ||
            image.getAttribute("xlink:href"));
        });
      }
    });
    return found;
  }

  function revokeBlobUrls(urls) {
    urls.forEach(function (url) {
      try {
        URL.revokeObjectURL(url);
      } catch (_error) {
        // Already released.
      }
    });
  }

  function receiveDocument(data) {
    var report = data.report && typeof data.report === "object" ? data.report : {};
    if (report.ok === false) {
      receiveFallback(data);
      return;
    }
    var sameTab = !!current && sameId(current.tab, data.tab);
    var sameFile = sameTab && current.displayPath === String(data.displayPath || "");
    var ratio = 0;
    if (displayed && current) {
      if (sameFile) {
        ratio = scrollRatio();
      } else if (!sameTab) {
        savedScroll.set(idKey(current.tab), scrollRatio());
      }
    }
    if (!sameTab && savedScroll.has(idKey(data.tab))) {
      ratio = savedScroll.get(idKey(data.tab));
      savedScroll.delete(idKey(data.tab));
    }

    renderSerial += 1;
    var serial = renderSerial;
    var started = now();
    packageCache = null;
    current = {
      tab: data.tab,
      generation: data.generation,
      fileName: String(data.fileName || ""),
      displayPath: String(data.displayPath || ""),
      packageUrl: String(data.packageUrl || ""),
      report: report,
      pages: 0,
      fallback: false
    };
    var size = formatBytes(report.sourceBytes);
    setIdentity(current.fileName || "Untitled",
      (size ? size + " · " : "") + "Opening", current.displayPath);
    root.dataset.renderState = "loading";
    elements.docBody.setAttribute("aria-busy", "true");

    var expected = current;
    fetchPackage(current.packageUrl).then(function (buffer) {
      if (serial !== renderSerial) {
        return null;
      }
      packageCache = { tab: expected.tab, generation: expected.generation, buffer: buffer };
      return renderPackage(serial, ratio, started, true);
    }).catch(function (error) {
      if (serial === renderSerial) {
        failRender(expected, error);
      }
    });
  }

  function failRender(expected, error) {
    var message = error && error.message ? String(error.message) : "Unknown error.";
    post({
      type: "renderFailed",
      tab: expected.tab,
      generation: expected.generation,
      message: message.slice(0, 500)
    });
    showRenderFailure();
  }

  // Parses into docx-preview's model, applies LeanDoc's model fixes, renders
  // detached nodes, and attaches them only if no newer request arrived.
  // Lets the page handle input and paint between the long steps of a render,
  // so the window stays responsive while a long document loads (P-04).
  function yieldToPage() {
    return new Promise(function (resolve) {
      window.setTimeout(resolve, 0);
    });
  }

  function renderPackage(serial, ratio, started, firstRender) {
    var options = renderOptions();
    var view = currentView;
    var expected = current;
    var parsed = null;
    return window.docx.parseAsync(packageCache.buffer, options).then(function (result) {
      parsed = result;
      return yieldToPage();
    }).then(function () {
      if (serial !== renderSerial) {
        return null;
      }
      Fixups.prepareModel(parsed);
      return yieldToPage().then(function () {
        if (serial !== renderSerial) {
          return null;
        }
        return window.docx.renderDocument(parsed, options);
      }).then(function (nodes) {
        if (!nodes) {
          return null;
        }
        if (serial !== renderSerial) {
          revokeBlobUrls(collectBlobUrls(nodes));
          return null;
        }
        return attachDocument(nodes, view, serial).then(function (attached) {
          if (attached) {
            finishRender(expected, ratio, started, firstRender, attached.movedWhileLoading);
          }
        });
      });
    });
  }

  function rerender(ratio) {
    if (!current || current.fallback || !packageCache) {
      return;
    }
    renderSerial += 1;
    var serial = renderSerial;
    var expected = current;
    elements.docBody.setAttribute("aria-busy", "true");
    root.dataset.renderState = "loading";
    renderPackage(serial, ratio, now(), false).catch(function (error) {
      if (serial === renderSerial) {
        failRender(expected, error);
      }
    });
  }

  // Long documents are attached a batch of pages at a time, one batch per
  // frame, with the first pages shown at once. Laying out and styling a
  // thousand pages in one task froze the page for seconds. "rendered" is
  // still posted only when every page is in place.
  var PROGRESSIVE_PAGES = 60;
  var FIRST_BATCH = 8;
  var BATCH = 20;

  function attachDocument(nodes, view, serial) {
    clearSearch();
    root.dataset.view = view;
    revokeBlobUrls(blobUrls);
    blobUrls = collectBlobUrls(nodes);
    var styles = [];
    var body = [];
    nodes.forEach(function (node) {
      (node.nodeName === "STYLE" ? styles : body).push(node);
    });
    var wrapper = body.filter(function (node) {
      return node.classList && node.classList.contains("docx-wrapper");
    })[0];
    var pages = wrapper ? Array.prototype.filter.call(wrapper.children, function (child) {
      return child.nodeName === "SECTION";
    }) : [];
    elements.docStyles.replaceChildren.apply(elements.docStyles, styles);
    if (pages.length <= PROGRESSIVE_PAGES) {
      elements.docBody.replaceChildren.apply(elements.docBody, body);
      prepareDocumentDom(pages.length ? pages : [elements.docBody], 0, Math.max(1, pages.length));
      return Promise.resolve({ movedWhileLoading: false });
    }
    var later = pages.slice(FIRST_BATCH);
    later.forEach(function (page) {
      wrapper.removeChild(page);
    });
    elements.docBody.replaceChildren.apply(elements.docBody, body);
    prepareDocumentDom(pages.slice(0, FIRST_BATCH), 0, pages.length);
    showLoadingPages(current && current.report);
    var startTop = elements.docScroller.scrollTop;
    var next = 0;
    return new Promise(function (resolve) {
      function step() {
        if (serial !== renderSerial) {
          resolve(null);
          return;
        }
        var batch = later.slice(next, next + BATCH);
        var fragment = document.createDocumentFragment();
        batch.forEach(function (page) {
          fragment.appendChild(page);
        });
        wrapper.appendChild(fragment);
        prepareDocumentDom(batch, FIRST_BATCH + next, pages.length);
        // Lay out this batch now. WebKit lays out pages below the window
        // only when something asks, so without this the whole document was
        // laid out in one long task when the render finished.
        void wrapper.offsetHeight;
        next += batch.length;
        if (next < later.length) {
          window.requestAnimationFrame(function () {
            window.setTimeout(step, 0);
          });
        } else {
          resolve({ movedWhileLoading: elements.docScroller.scrollTop !== startTop });
        }
      }
      window.requestAnimationFrame(function () {
        window.setTimeout(step, 0);
      });
    });
  }

  // The first pages of a long document, readable and scrollable while the
  // rest arrives. Find, zoom, and the view switch wait for the whole document.
  function showLoadingPages(report) {
    elements.statePane.hidden = true;
    elements.readerPane.hidden = false;
    delete elements.statePane.dataset.state;
    root.setAttribute("data-has-document", "");
    // The outline pane takes its place now, so the page width and the fit
    // zoom are final from the first batch: changing the zoom at the end
    // would lay out every page again.
    var outline = report && Array.isArray(report.outline) ? report.outline : [];
    elements.outline.hidden = outline.length === 0;
    applyZoom(false);
    focusDocumentIfIdle();
  }

  function finishRender(expected, ratio, started, firstRender, movedWhileLoading) {
    var pages = elements.docBody.querySelectorAll(".docx-wrapper > section.docx").length;
    expected.pages = pages;
    var size = formatBytes(expected.report.sourceBytes);
    var meta = [];
    if (size) {
      meta.push(size);
    }
    if (currentView === "page") {
      meta.push(pages === 1 ? "1 page" : pages + " pages");
    } else {
      meta.push("Reading view");
    }
    setIdentity(expected.fileName || "Untitled", meta.join(" · "), expected.displayPath);

    elements.statePane.hidden = true;
    elements.readerPane.hidden = false;
    delete elements.statePane.dataset.state;
    root.setAttribute("data-has-document", "");
    displayed = true;
    setControlsEnabled(true);
    updateViewButtons();
    buildOutline(expected.report);
    updateFidelity(firstRender);
    applyZoom(false);
    elements.docBody.setAttribute("aria-busy", "false");
    // A reader who scrolled the first pages while the rest loaded keeps
    // that position.
    var keepPosition = movedWhileLoading && !ratio;
    if (!keepPosition) {
      elements.docScroller.scrollLeft = 0;
      scrollToRatio(ratio);
    }
    window.requestAnimationFrame(function () {
      if (current === expected) {
        if (!keepPosition) {
          scrollToRatio(ratio);
        }
        updateOutlineCurrent();
      }
    });
    if (elements.findInput.value.trim()) {
      runSearch(false);
    }
    root.dataset.renderState = "ready";
    root.dataset.pages = String(pages);
    focusDocumentIfIdle();
    post({
      type: "rendered",
      tab: expected.tab,
      generation: expected.generation,
      pages: pages,
      ms: Math.round(now() - started)
    });
  }

  // Page Down, Space, the arrows, Home, and End scroll whatever holds the
  // focus. A freshly opened document leaves it on the body, which does not
  // scroll, so the keyboard did nothing until the reader clicked the page.
  // The document takes the focus unless a control already has it.
  function focusDocumentIfIdle() {
    var active = document.activeElement;
    if (active && active !== document.body && active !== root) {
      return;
    }
    try {
      elements.docScroller.focus({ preventScroll: true });
    } catch (_error) {
      elements.docScroller.focus();
    }
  }

  // Links, anchors, and ids inside the rendered document

  var CSS_UNITS = { px: 1, pt: 96 / 72, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, pc: 16 };

  function cssPixels(value) {
    var match = /^(-?[\d.]+)(px|pt|in|cm|mm|pc)$/.exec(String(value || "").trim());
    return match ? parseFloat(match[1]) * CSS_UNITS[match[2]] : NaN;
  }

  // A lazily laid-out page is sized by contain-intrinsic-size until it is
  // drawn. That size is the content box, so it is the page size less the page
  // margins docx-preview writes as padding. With the whole page size instead,
  // every page not yet drawn was 192 px too tall on Letter paper: the
  // scrollbar was wrong, and Home, End, and jumps landed short as pages laid
  // out during the scroll.
  function lazyPageSize(section) {
    var style = section.style;
    var width = cssPixels(style.width) - cssPixels(style.paddingLeft) - cssPixels(style.paddingRight);
    var height = cssPixels(style.minHeight) - cssPixels(style.paddingTop) -
      cssPixels(style.paddingBottom);
    if (!(width > 0) || !(height > 0)) {
      return "";
    }
    return "auto " + Math.round(width) + "px auto " + Math.round(height) + "px";
  }

  // PAGE, NUMPAGES, and SECTIONPAGES results arrive as markers (fixups.js
  // markPageFields); each page gets its own number here.
  function numberPageFields(page, pageNumber, pageCount) {
    var walker = document.createTreeWalker(page, NodeFilter.SHOW_TEXT);
    var node;
    while ((node = walker.nextNode())) {
      if (node.nodeValue.indexOf(Fixups.PAGE_FIELD_START) >= 0) {
        node.nodeValue = Fixups.fillPageFields(node.nodeValue, pageNumber, pageCount);
      }
    }
  }

  // Prepares newly attached pages: lazy layout, page numbers, document ids
  // moved aside, and links. `first` is the index of pages[0] in the document.
  function prepareDocumentDom(pages, first, pageCount) {
    pages.forEach(function (page, offset) {
      if (currentView === "page" && page.nodeName === "SECTION" &&
          !page.querySelector("p[class*='docx-num-']")) {
        var size = lazyPageSize(page);
        if (size) {
          page.style.containIntrinsicSize = size;
        }
        page.classList.add("ld-lazy");
      }
      numberPageFields(page, first + offset + 1, pageCount);
      // Document ids (bookmarks) move to a data attribute so they can never
      // collide with the reader's own element ids.
      page.querySelectorAll("[id]").forEach(function (node) {
        node.setAttribute("data-ld-anchor", node.id);
        node.removeAttribute("id");
      });
      page.querySelectorAll("a").forEach(prepareLink);
    });
  }

  function prepareLink(link) {
    link.removeAttribute("target");
    link.removeAttribute("download");
    link.removeAttribute("ping");
    var raw = link.getAttribute("href");
    if (raw === null) {
      return;
    }
    var target = Fixups.classifyHref(raw);
    if (target.kind === "external") {
      link.setAttribute("href", target.href);
      link.setAttribute("rel", "noopener noreferrer");
      link.setAttribute("title", target.href);
      link.dataset.ldLink = "external";
    } else if (target.kind === "internal") {
      link.setAttribute("href", "#" + target.anchor);
      link.dataset.ldLink = "internal";
    } else {
      // Anything else reads as plain text and cannot be activated.
      link.removeAttribute("href");
      link.dataset.ldLink = "none";
      link.setAttribute("title", "LeanDoc opens only web and email links.");
    }
  }

  function findAnchor(name) {
    var candidates = elements.docBody.querySelectorAll("[data-ld-anchor]");
    for (var index = 0; index < candidates.length; index += 1) {
      if (candidates[index].getAttribute("data-ld-anchor") === name) {
        return candidates[index];
      }
    }
    return null;
  }

  function handleDocumentClick(event) {
    var link = event.target && event.target.closest ? event.target.closest("a") : null;
    if (!link || !elements.docBody.contains(link)) {
      return;
    }
    event.preventDefault();
    if (link.dataset.ldLink === "external") {
      post({ type: "link", href: link.getAttribute("href") });
    } else if (link.dataset.ldLink === "internal") {
      var target = findAnchor((link.getAttribute("href") || "").slice(1));
      var block = target && target.closest ? target.closest("p, td, li") || target : target;
      if (block) {
        block.scrollIntoView({ block: "start" });
      }
    }
  }

  // Fidelity bar

  function documentKey(entry) {
    return idKey(entry.tab) + "\n" + entry.displayPath;
  }

  function updateFidelity(firstRender) {
    var info = current && current.report ? Wording.describeFidelity(current.report) : null;
    if (!info) {
      elements.fidelityBar.hidden = true;
      return;
    }
    var collapsed = collapsedBars.get(idKey(current.tab)) === true;
    elements.fidelityBar.hidden = false;
    elements.fidelityText.textContent = collapsed ? info.summary : info.text;
    if (collapsed) {
      elements.fidelityBar.setAttribute("data-collapsed", "");
    } else {
      elements.fidelityBar.removeAttribute("data-collapsed");
    }
    elements.fidelityCollapse.setAttribute("aria-expanded", collapsed ? "false" : "true");
    elements.fidelityCollapse.setAttribute("aria-label",
      collapsed ? "Expand fidelity notes" : "Collapse fidelity notes");
    elements.fidelityCollapse.title = collapsed ? "Expand" : "Collapse";
    elements.fidelityDetails.hidden = collapsed;

    var fragment = document.createDocumentFragment();
    info.items.forEach(function (item) {
      var row = document.createElement("li");
      row.dataset.code = item.code;
      var label = document.createElement("span");
      label.className = "feature-label";
      label.textContent = item.label;
      var count = document.createElement("span");
      count.className = "feature-count";
      count.textContent = String(item.count);
      var status = document.createElement("span");
      status.className = "feature-status";
      status.textContent = item.status;
      row.append(label, count, status);
      fragment.appendChild(row);
    });
    elements.fidelityList.replaceChildren(fragment);
    var expanded = elements.fidelityDetails.getAttribute("aria-expanded") === "true";
    elements.fidelityList.hidden = collapsed || !expanded;

    var key = documentKey(current);
    if (firstRender && !announcedDocuments.has(key)) {
      announcedDocuments.add(key);
      announce(info.text);
    }
  }

  function toggleFidelityCollapsed() {
    if (!current) {
      return;
    }
    var key = idKey(current.tab);
    collapsedBars.set(key, collapsedBars.get(key) !== true);
    updateFidelity(false);
  }

  function toggleFidelityDetails() {
    var expanded = elements.fidelityDetails.getAttribute("aria-expanded") === "true";
    elements.fidelityDetails.setAttribute("aria-expanded", expanded ? "false" : "true");
    elements.fidelityDetails.textContent = expanded ? "Details" : "Hide details";
    elements.fidelityList.hidden = expanded;
  }

  // Outline

  function bodyParagraphs() {
    return Array.prototype.slice.call(
      elements.docBody.querySelectorAll("section.docx > article p"));
  }

  function textMatches(node, text) {
    var expected = Fixups.normalizeText(text);
    if (!expected) {
      return true;
    }
    var actual = Fixups.normalizeText(node.textContent);
    if (!actual) {
      return false;
    }
    var probe = expected.slice(0, 40);
    return actual.indexOf(probe) === 0 || expected.indexOf(actual) === 0;
  }

  // Paragraphs by the core's paragraph index (class ld-pi-N), built once per
  // outline: a query per heading over a 1,000-page document took a second.
  function paragraphIndexMap() {
    var map = new Map();
    elements.docBody.querySelectorAll("p.ld-p").forEach(function (paragraph) {
      var match = /(?:^|\s)ld-pi-(\d+)(?:\s|$)/.exec(paragraph.className);
      if (match && !map.has(Number(match[1]))) {
        map.set(Number(match[1]), paragraph);
      }
    });
    return map;
  }

  function findOutlineTarget(entry, previous, paragraphs, indexMap) {
    var index = entry.paragraph;
    var candidate = Number.isInteger(index) && index >= 0
      ? indexMap.get(index) || null
      : null;
    if (candidate && textMatches(candidate, entry.text)) {
      return candidate;
    }
    // The index did not land on the heading: match by text, after the
    // previous entry when possible.
    var expected = Fixups.normalizeText(entry.text);
    if (!expected) {
      return candidate;
    }
    var fallback = null;
    for (var position = 0; position < paragraphs.length; position += 1) {
      var paragraph = paragraphs[position];
      if (Fixups.normalizeText(paragraph.textContent) !== expected) {
        continue;
      }
      if (!previous ||
          (previous.compareDocumentPosition(paragraph) & Node.DOCUMENT_POSITION_FOLLOWING)) {
        return paragraph;
      }
      fallback = fallback || paragraph;
    }
    return fallback || candidate;
  }

  function buildOutline(report) {
    var entries = report && Array.isArray(report.outline) ? report.outline : [];
    outlineEntries = [];
    currentOutlineIndex = -1;
    pinnedOutline = null;
    var fragment = document.createDocumentFragment();
    var previous = null;
    var paragraphs = null;
    var indexMap = entries.length ? paragraphIndexMap() : new Map();
    entries.slice(0, 2000).forEach(function (raw) {
      if (!raw || typeof raw !== "object") {
        return;
      }
      var paragraph = Number(raw.paragraph !== undefined ? raw.paragraph : raw.paragraphIndex);
      var entry = {
        level: Math.min(9, Math.max(1, Number(raw.level) || 1)),
        text: String(raw.text || "").trim(),
        paragraph: Number.isInteger(paragraph) ? paragraph : -1
      };
      var candidate = indexMap.get(entry.paragraph) || null;
      if (!candidate || !textMatches(candidate, entry.text)) {
        paragraphs = paragraphs || bodyParagraphs();
      }
      var target = findOutlineTarget(entry, previous, paragraphs || [], indexMap);
      if (target) {
        target.setAttribute("data-ld-target", String(outlineEntries.length));
        previous = target;
      }
      entry.target = target;
      var item = document.createElement("li");
      var link = document.createElement("a");
      link.href = "#";
      link.dataset.index = String(outlineEntries.length);
      link.dataset.level = String(entry.level);
      link.textContent = entry.text || "Untitled section";
      link.title = entry.text;
      item.appendChild(link);
      fragment.appendChild(item);
      entry.link = link;
      outlineEntries.push(entry);
    });
    elements.outlineList.replaceChildren(fragment);
    elements.outline.hidden = outlineEntries.length === 0;
  }

  function outlineTargetTop(entry, scrollerTop) {
    return entry.target.getBoundingClientRect().top - scrollerTop;
  }

  function updateOutlineCurrent() {
    scrollFrame = 0;
    if (!displayed || !outlineEntries.length) {
      return;
    }
    if (pinnedOutline !== null) {
      var moved = Math.abs(elements.docScroller.scrollTop - pinnedOutline.scrollTop);
      if (outlineEntries[pinnedOutline.index] && moved <= elements.docScroller.clientHeight / 2) {
        return;
      }
      pinnedOutline = null;
    }
    var withTargets = outlineEntries.filter(function (entry) {
      return entry.target && entry.target.isConnected;
    });
    var scrollerTop = elements.docScroller.getBoundingClientRect().top;
    var threshold = Math.max(48, elements.docScroller.clientHeight * 0.25);
    var low = 0;
    var high = withTargets.length - 1;
    var found = -1;
    while (low <= high) {
      var middle = (low + high) >> 1;
      if (outlineTargetTop(withTargets[middle], scrollerTop) <= threshold) {
        found = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    var index = found >= 0 ? outlineEntries.indexOf(withTargets[found]) : 0;
    if (elements.docScroller.scrollTop <= 1) {
      index = 0;
    }
    if (index === currentOutlineIndex) {
      return;
    }
    if (currentOutlineIndex >= 0 && outlineEntries[currentOutlineIndex]) {
      outlineEntries[currentOutlineIndex].link.removeAttribute("aria-current");
    }
    currentOutlineIndex = index;
    var link = outlineEntries[index] && outlineEntries[index].link;
    if (link) {
      link.setAttribute("aria-current", "location");
      var list = elements.outlineList;
      var top = link.offsetTop - list.offsetTop;
      if (top < list.scrollTop || top + link.offsetHeight > list.scrollTop + list.clientHeight) {
        list.scrollTop = Math.max(0, top - list.clientHeight / 3);
      }
    }
  }

  function scheduleOutlineUpdate() {
    if (!scrollFrame) {
      scrollFrame = window.requestAnimationFrame(updateOutlineCurrent);
    }
  }

  function goToOutlineEntry(index) {
    var entry = outlineEntries[index];
    if (!entry || !entry.target) {
      return;
    }
    entry.target.scrollIntoView({ block: "start" });
    entry.target.setAttribute("tabindex", "-1");
    try {
      entry.target.focus({ preventScroll: true });
    } catch (_error) {
      entry.target.focus();
    }
    pinnedOutline = null;
    updateOutlineCurrent();
    if (currentOutlineIndex !== index) {
      if (currentOutlineIndex >= 0 && outlineEntries[currentOutlineIndex]) {
        outlineEntries[currentOutlineIndex].link.removeAttribute("aria-current");
      }
      currentOutlineIndex = index;
      entry.link.setAttribute("aria-current", "location");
    }
    pinnedOutline = { index: index, scrollTop: elements.docScroller.scrollTop };
  }

  function toggleOutline() {
    var collapsed = !elements.outline.hasAttribute("data-collapsed");
    if (collapsed) {
      elements.outline.setAttribute("data-collapsed", "");
    } else {
      elements.outline.removeAttribute("data-collapsed");
    }
    elements.outlineToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    elements.outlineToggle.setAttribute("aria-label", collapsed ? "Show outline" : "Hide outline");
    elements.outlineToggle.title = collapsed ? "Show outline" : "Hide outline";
    if (zoomMode !== "fixed") {
      applyZoom(true);
    }
  }

  // Views and zoom

  function updateViewButtons() {
    elements.viewPage.setAttribute("aria-pressed", currentView === "page" ? "true" : "false");
    elements.viewReading.setAttribute("aria-pressed", currentView === "reading" ? "true" : "false");
  }

  function setView(view, fromUser) {
    var next = view === "reading" ? "reading" : "page";
    if (next === currentView) {
      updateViewButtons();
      return;
    }
    // The page keeps its current layout until the new render replaces it.
    var ratio = displayed ? scrollRatio() : 0;
    currentView = next;
    if (!displayed) {
      root.dataset.view = next;
    }
    updateViewButtons();
    if (fromUser) {
      post({ type: "setView", view: next });
    }
    rerender(ratio);
  }

  function pageWidthPixels() {
    var widest = 0;
    var sections = elements.docBody.querySelectorAll(".docx-wrapper > section.docx");
    for (var index = 0; index < sections.length && index < 64; index += 1) {
      var width = sections[index].style.width || "";
      var value = parseFloat(width);
      if (/pt$/.test(width)) {
        value = value * 96 / 72;
      } else if (!/px$/.test(width)) {
        value = 0;
      }
      widest = Math.max(widest, value || 0);
    }
    return widest || 816;
  }

  function fitFactor() {
    if (currentView === "reading") {
      return 1;
    }
    var available = elements.docScroller.clientWidth - 64;
    if (available <= 0) {
      return 1;
    }
    return Math.max(0.5, Math.min(3, available / pageWidthPixels()));
  }

  function effectiveZoom() {
    if (zoomMode === "fit") {
      return fitFactor();
    }
    if (zoomMode === "auto") {
      return Math.min(1, fitFactor());
    }
    return zoomFactor;
  }

  function updateZoomLabel(factor) {
    var percent = Math.round(factor * 100) + "%";
    elements.zoomValue.textContent = percent;
    var next = zoomMode === "fit" ? "100%" : "fit width";
    elements.zoomValue.setAttribute("aria-label",
      "Zoom " + percent + (zoomMode === "fit" ? ", fit width" : "") +
      ". Activate for " + next + ".");
    elements.zoomValue.title = shortcut(zoomMode === "fit"
      ? "Fit width. Activate for 100% (Ctrl+0 resets)"
      : "Activate to fit width (Ctrl+0 resets)");
    if (displayed) {
      elements.zoomOut.disabled = factor <= ZOOM_STEPS[0] + 0.001;
      elements.zoomIn.disabled = factor >= ZOOM_STEPS[ZOOM_STEPS.length - 1] - 0.001;
    }
    root.dataset.zoom = String(Math.round(factor * 100));
    root.dataset.zoomMode = zoomMode;
  }

  function applyZoom(keepPosition) {
    var factor = effectiveZoom();
    var ratio = keepPosition ? scrollRatio() : 0;
    var wrapper = elements.docBody.querySelector(".docx-wrapper");
    if (wrapper) {
      var identity = Math.abs(factor - 1) < 0.001;
      if (supportsZoom) {
        wrapper.style.zoom = identity ? "" : String(factor);
      } else {
        // Without CSS zoom: scale, and reserve the scaled size for scrolling.
        wrapper.style.transformOrigin = factor < 1 ? "50% 0" : "0 0";
        wrapper.style.transform = identity ? "" : "scale(" + factor + ")";
        elements.docBody.style.width = identity || factor < 1 ? "" : wrapper.offsetWidth * factor + "px";
        elements.docBody.style.height = identity ? "" : wrapper.offsetHeight * factor + "px";
      }
    }
    updateZoomLabel(factor);
    if (keepPosition) {
      scrollToRatio(ratio);
    }
    scheduleOutlineUpdate();
  }

  function stepZoom(direction) {
    if (!displayed) {
      return;
    }
    var factor = effectiveZoom();
    var next = factor;
    if (direction > 0) {
      for (var up = 0; up < ZOOM_STEPS.length; up += 1) {
        if (ZOOM_STEPS[up] > factor + 0.001) {
          next = ZOOM_STEPS[up];
          break;
        }
      }
    } else {
      for (var down = ZOOM_STEPS.length - 1; down >= 0; down -= 1) {
        if (ZOOM_STEPS[down] < factor - 0.001) {
          next = ZOOM_STEPS[down];
          break;
        }
      }
    }
    zoomMode = "fixed";
    zoomFactor = next;
    applyZoom(true);
  }

  function toggleFitWidth() {
    if (!displayed) {
      return;
    }
    if (zoomMode === "fit") {
      zoomMode = "fixed";
      zoomFactor = 1;
    } else {
      zoomMode = "fit";
    }
    applyZoom(true);
  }

  function resetZoom() {
    zoomMode = "auto";
    applyZoom(true);
  }

  // Find

  function clearSearch() {
    if (window.CSS && CSS.highlights) {
      CSS.highlights.delete("leandoc-find");
      CSS.highlights.delete("leandoc-find-current");
    }
    if (search.marks) {
      elements.docBody.querySelectorAll("mark.ld-find").forEach(function (mark) {
        var parent = mark.parentNode;
        while (mark.firstChild) {
          parent.insertBefore(mark.firstChild, mark);
        }
        parent.removeChild(mark);
        parent.normalize();
      });
    }
    search = { matches: [], index: -1, marks: false };
    elements.findCount.textContent = "";
  }

  function searchWalker() {
    return document.createTreeWalker(
      elements.docBody,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
      {
        acceptNode: function (node) {
          if (node.nodeType === 1) {
            var name = node.nodeName;
            if (name === "HEADER" || name === "FOOTER" || name === "STYLE" ||
                name === "SCRIPT") {
              return NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_SKIP;
          }
          return node.nodeValue ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
        }
      });
  }

  function lowered(text) {
    var lower = text.toLocaleLowerCase();
    if (lower.length === text.length) {
      return lower;
    }
    var result = "";
    for (var index = 0; index < text.length; index += 1) {
      var char = text.charAt(index).toLocaleLowerCase();
      result += char.length === 1 ? char : text.charAt(index);
    }
    return result;
  }

  // Matches are found per paragraph across text nodes, so a word split over
  // differently formatted runs is still found.
  function collectMatches(query) {
    var matches = [];
    var walker = searchWalker();
    var block = null;
    var segments = [];
    var text = "";

    function flush() {
      if (!text) {
        return;
      }
      var start = 0;
      while ((start = text.indexOf(query, start)) !== -1 && matches.length < MAX_MATCHES) {
        var end = start + query.length;
        var parts = [];
        for (var index = 0; index < segments.length; index += 1) {
          var segment = segments[index];
          var segmentEnd = segment.offset + segment.node.nodeValue.length;
          if (segmentEnd <= start || segment.offset >= end) {
            continue;
          }
          parts.push({
            node: segment.node,
            start: Math.max(0, start - segment.offset),
            end: Math.min(segment.node.nodeValue.length, end - segment.offset)
          });
        }
        if (parts.length) {
          matches.push(parts);
        }
        start = end;
      }
      segments = [];
      text = "";
    }

    var node;
    while ((node = walker.nextNode()) && matches.length < MAX_MATCHES) {
      var parent = node.parentNode;
      var nodeBlock = parent && parent.closest ? parent.closest("p, li, td, th") : null;
      if (nodeBlock !== block) {
        flush();
        block = nodeBlock;
      }
      segments.push({ node: node, offset: text.length });
      text += lowered(node.nodeValue);
    }
    flush();
    return matches;
  }

  function matchRange(parts) {
    var range = document.createRange();
    range.setStart(parts[0].node, parts[0].start);
    range.setEnd(parts[parts.length - 1].node, parts[parts.length - 1].end);
    return range;
  }

  function wrapMatches(matches) {
    // Reverse document order keeps earlier offsets valid while splitting.
    for (var match = matches.length - 1; match >= 0; match -= 1) {
      var marks = [];
      for (var part = matches[match].length - 1; part >= 0; part -= 1) {
        var piece = matches[match][part];
        var middle = piece.node.splitText(piece.start);
        middle.splitText(piece.end - piece.start);
        var mark = document.createElement("mark");
        mark.className = "ld-find";
        middle.parentNode.insertBefore(mark, middle);
        mark.appendChild(middle);
        marks.unshift(mark);
      }
      matches[match] = { marks: marks };
    }
  }

  function runSearch(resetIndex) {
    var previousIndex = search.index;
    clearSearch();
    var query = lowered(elements.findInput.value.trim());
    if (!query || !displayed) {
      return;
    }
    var matches = collectMatches(query);
    if (window.Highlight && window.CSS && CSS.highlights) {
      var all = new Highlight();
      search.matches = matches.map(function (parts) {
        var range = matchRange(parts);
        all.add(range);
        return { range: range };
      });
      CSS.highlights.set("leandoc-find", all);
    } else {
      wrapMatches(matches);
      search.matches = matches;
      search.marks = true;
    }
    if (search.matches.length) {
      var start = resetIndex ? 0 : Math.min(Math.max(previousIndex, 0), search.matches.length - 1);
      selectMatch(start);
    } else {
      elements.findCount.textContent = "0";
    }
  }

  function selectMatch(index) {
    var count = search.matches.length;
    if (!count) {
      return;
    }
    if (search.index >= 0 && search.marks && search.matches[search.index]) {
      search.matches[search.index].marks.forEach(function (mark) {
        mark.removeAttribute("data-current");
      });
    }
    search.index = (index + count) % count;
    var match = search.matches[search.index];
    var anchor;
    if (match.range) {
      var currentHighlight = new Highlight();
      currentHighlight.add(match.range);
      CSS.highlights.set("leandoc-find-current", currentHighlight);
      anchor = match.range.startContainer.parentElement;
    } else {
      match.marks.forEach(function (mark) {
        mark.setAttribute("data-current", "");
      });
      anchor = match.marks[0];
    }
    elements.findCount.textContent = (search.index + 1) + "/" + count;
    if (anchor) {
      anchor.scrollIntoView({ block: "center", inline: "nearest" });
    }
  }

  function moveSearch(direction) {
    if (elements.findInput.disabled) {
      return;
    }
    if (!elements.findInput.value.trim()) {
      elements.findInput.focus();
      return;
    }
    if (!search.matches.length) {
      runSearch(true);
      return;
    }
    selectMatch(search.index + direction);
  }

  // Copy

  function documentText() {
    var lines = [];
    elements.docBody.querySelectorAll(".docx-wrapper > section.docx").forEach(function (section) {
      Array.prototype.forEach.call(section.children, function (child) {
        if (child.nodeName === "HEADER" || child.nodeName === "FOOTER") {
          return;
        }
        child.querySelectorAll("p").forEach(function (paragraph) {
          if (paragraph.parentElement && paragraph.parentElement.closest("p")) {
            return;
          }
          lines.push(paragraph.textContent.replace(/ /g, "\t"));
        });
      });
    });
    return lines.join("\n").trim();
  }

  function copyWithCommand(text) {
    var copied = false;
    function fill(event) {
      event.clipboardData.setData("text/plain", text);
      event.preventDefault();
      copied = true;
    }
    document.addEventListener("copy", fill);
    try {
      document.execCommand("copy");
    } finally {
      document.removeEventListener("copy", fill);
    }
    return copied ? Promise.resolve() : Promise.reject(new Error("Copy failed."));
  }

  function writeClipboardText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(function () {
        return copyWithCommand(text);
      });
    }
    return copyWithCommand(text);
  }

  function copyAll() {
    if (!displayed) {
      return;
    }
    writeClipboardText(documentText()).then(function () {
      announce("Document copied as text.");
      showStatus("Document copied as text.", "info");
    }, function () {
      showStatus("LeanDoc could not copy to the clipboard.", "error");
    });
  }

  // Tabs

  function tabLabel(tab, duplicateNames) {
    if (!duplicateNames.has(tab.name.toLocaleLowerCase())) {
      return tab.name;
    }
    var parts = tab.path.split(/[\\/]/).filter(Boolean);
    return parts.length > 1 ? tab.name + " · " + parts[parts.length - 2] : tab.name;
  }

  function renderTabs() {
    var visible = tabs.length > 1;
    elements.tabStrip.hidden = !visible;
    var seen = new Set();
    var duplicates = new Set();
    tabs.forEach(function (tab) {
      var key = tab.name.toLocaleLowerCase();
      if (seen.has(key)) {
        duplicates.add(key);
      }
      seen.add(key);
    });
    var fragment = document.createDocumentFragment();
    tabs.forEach(function (tab) {
      var selected = sameId(tab.id, activeTabId);
      var item = document.createElement("div");
      item.className = "tab";
      item.setAttribute("role", "tab");
      item.setAttribute("aria-selected", selected ? "true" : "false");
      item.setAttribute("aria-controls", "readerPane");
      item.tabIndex = selected ? 0 : -1;
      item.dataset.tabKey = idKey(tab.id);
      item.title = tab.path;
      var label = document.createElement("span");
      label.className = "tab-label";
      label.textContent = tabLabel(tab, duplicates);
      var close = document.createElement("span");
      close.className = "tab-close";
      // A tab may not contain a control (ARIA), so the close button is for
      // the pointer only; the keyboard closes a tab with Delete or Ctrl+W.
      close.title = shortcut("Close (Ctrl+W)");
      close.setAttribute("aria-hidden", "true");
      item.setAttribute("aria-keyshortcuts", isMac ? "Delete Meta+W" : "Delete Control+W");
      item.append(label, close);
      fragment.appendChild(item);
    });
    elements.tabStrip.replaceChildren(fragment);
    var selectedTab = elements.tabStrip.querySelector('[aria-selected="true"]');
    if (visible && selectedTab) {
      selectedTab.scrollIntoView({ block: "nearest", inline: "nearest" });
      if (focusTabAfterRender) {
        selectedTab.focus();
      }
    }
    focusTabAfterRender = false;
  }

  function receiveTabs(data) {
    tabs = (Array.isArray(data.tabs) ? data.tabs.slice(0, 1000) : [])
      .filter(function (tab) {
        return tab && idKey(tab.id) !== "";
      })
      .map(function (tab) {
        return {
          id: tab.id,
          name: String(tab.name || "Untitled"),
          path: String(tab.path || "")
        };
      });
    activeTabId = data.active === undefined ? null : data.active;
    var open = new Set(tabs.map(function (tab) {
      return idKey(tab.id);
    }));
    [savedScroll, collapsedBars].forEach(function (map) {
      map.forEach(function (_value, key) {
        if (!open.has(key)) {
          map.delete(key);
        }
      });
    });
    renderTabs();
  }

  function tabFrom(target) {
    var node = target && target.closest ? target.closest(".tab") : null;
    if (!node) {
      return null;
    }
    for (var index = 0; index < tabs.length; index += 1) {
      if (idKey(tabs[index].id) === node.dataset.tabKey) {
        return tabs[index];
      }
    }
    return null;
  }

  function tabIndex(id) {
    for (var index = 0; index < tabs.length; index += 1) {
      if (sameId(tabs[index].id, id)) {
        return index;
      }
    }
    return -1;
  }

  function selectTab(id, moveFocus) {
    if (idKey(id) === "" || sameId(id, activeTabId)) {
      return;
    }
    focusTabAfterRender = !!moveFocus;
    post({ type: "selectTab", id: id });
  }

  function closeTab(id) {
    if (idKey(id) !== "") {
      post({ type: "closeTab", id: id });
    }
  }

  function cycleTab(direction) {
    if (tabs.length < 2) {
      return;
    }
    var index = Math.max(0, tabIndex(activeTabId));
    selectTab(tabs[(index + direction + tabs.length) % tabs.length].id, false);
  }

  // Host messages

  function handleHostMessage(raw) {
    var data = raw;
    if (typeof raw === "string") {
      try {
        data = JSON.parse(raw);
      } catch (_error) {
        return;
      }
    }
    if (!data || typeof data !== "object") {
      return;
    }
    switch (data.type) {
      case "host":
        receiveHost(data);
        break;
      case "theme":
        applyTheme(data.theme);
        if (data.view === "page" || data.view === "reading") {
          setView(data.view, false);
        }
        break;
      case "tabs":
        receiveTabs(data);
        break;
      case "document":
        receiveDocument(data);
        break;
      case "fallback":
        receiveFallback(data);
        break;
      case "empty":
        receiveEmpty(data);
        break;
      case "status":
        showStatus(String(data.message || ""), data.tone);
        break;
      default:
        break;
    }
  }

  // Events

  elements.openButton.addEventListener("click", function () {
    post({ type: "open" });
  });
  elements.stateOpenButton.addEventListener("click", function () {
    post({ type: "open" });
  });
  [elements.editorButton, elements.fidelityEditor, elements.stateEditorButton]
    .forEach(function (button) {
      button.addEventListener("click", openInEditor);
    });
  elements.themeButton.addEventListener("click", cycleTheme);
  elements.viewPage.addEventListener("click", function () {
    setView("page", true);
  });
  elements.viewReading.addEventListener("click", function () {
    setView("reading", true);
  });
  elements.zoomIn.addEventListener("click", function () {
    stepZoom(1);
  });
  elements.zoomOut.addEventListener("click", function () {
    stepZoom(-1);
  });
  elements.zoomValue.addEventListener("click", toggleFitWidth);
  elements.fidelityCollapse.addEventListener("click", toggleFidelityCollapsed);
  elements.fidelityDetails.addEventListener("click", toggleFidelityDetails);
  elements.outlineToggle.addEventListener("click", toggleOutline);
  elements.outlineList.addEventListener("click", function (event) {
    var link = event.target && event.target.closest ? event.target.closest("a") : null;
    if (link) {
      event.preventDefault();
      goToOutlineEntry(Number(link.dataset.index));
    }
  });
  elements.recentList.addEventListener("click", function (event) {
    var button = event.target && event.target.closest ? event.target.closest(".recent-item") : null;
    if (button) {
      var message = { type: "openRecent", path: button.dataset.path };
      if (button.dataset.recentId !== undefined) {
        message.id = button.dataset.recentId;
      }
      post(message);
    }
  });
  elements.clearRecent.addEventListener("click", function () {
    post({ type: "clearRecent" });
    elements.recentList.replaceChildren();
    elements.recentSection.hidden = true;
  });

  elements.docBody.addEventListener("click", handleDocumentClick);
  elements.docBody.addEventListener("auxclick", function (event) {
    if (event.target && event.target.closest && event.target.closest("a")) {
      event.preventDefault();
    }
  });
  elements.docBody.addEventListener("dragstart", function (event) {
    if (event.target && event.target.closest && event.target.closest("a, img")) {
      event.preventDefault();
    }
  });
  elements.docScroller.addEventListener("scroll", scheduleOutlineUpdate, { passive: true });
  ["wheel", "pointerdown", "touchstart", "keydown"].forEach(function (type) {
    elements.docScroller.addEventListener(type, function () {
      if (pinnedOutline !== null) {
        pinnedOutline = null;
        scheduleOutlineUpdate();
      }
    }, { passive: true });
  });
  elements.docScroller.addEventListener("wheel", function (event) {
    if (!(event.ctrlKey || (isMac && event.metaKey)) || !displayed) {
      return;
    }
    event.preventDefault();
    wheelTotal += event.deltaY;
    if (Math.abs(wheelTotal) >= 40 || Math.abs(event.deltaY) >= 40) {
      stepZoom(wheelTotal < 0 ? 1 : -1);
      wheelTotal = 0;
    }
  }, { passive: false });

  elements.tabStrip.addEventListener("click", function (event) {
    var tab = tabFrom(event.target);
    if (!tab) {
      return;
    }
    if (event.target.closest(".tab-close")) {
      closeTab(tab.id);
    } else {
      selectTab(tab.id, false);
    }
  });
  elements.tabStrip.addEventListener("mousedown", function (event) {
    if (event.button === 1) {
      event.preventDefault();
    }
  });
  elements.tabStrip.addEventListener("auxclick", function (event) {
    var tab = event.button === 1 ? tabFrom(event.target) : null;
    if (tab) {
      event.preventDefault();
      closeTab(tab.id);
    }
  });
  elements.tabStrip.addEventListener("keydown", function (event) {
    var tab = tabFrom(event.target);
    var index = tab ? tabIndex(tab.id) : -1;
    if (index < 0) {
      return;
    }
    var next = -1;
    if (event.key === "ArrowRight") {
      next = (index + 1) % tabs.length;
    } else if (event.key === "ArrowLeft") {
      next = (index - 1 + tabs.length) % tabs.length;
    } else if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = tabs.length - 1;
    } else if (event.key === "Delete") {
      event.preventDefault();
      closeTab(tab.id);
      return;
    }
    if (next >= 0) {
      event.preventDefault();
      selectTab(tabs[next].id, true);
    }
  });

  elements.findInput.addEventListener("input", function () {
    runSearch(true);
  });
  elements.findInput.addEventListener("keydown", function (event) {
    if (event.key === "Enter") {
      event.preventDefault();
      moveSearch(event.shiftKey ? -1 : 1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      elements.findInput.value = "";
      clearSearch();
      elements.docScroller.focus();
    }
  });

  document.addEventListener("keydown", function (event) {
    var key = typeof event.key === "string" ? event.key.toLowerCase() : "";
    var mod = modifier(event);
    var inFind = event.target === elements.findInput;
    if (mod && !event.altKey && !event.shiftKey && key === "o") {
      event.preventDefault();
      post({ type: "open" });
    } else if (mod && !event.altKey && !event.shiftKey && key === "f") {
      event.preventDefault();
      if (!elements.findInput.disabled) {
        elements.findInput.focus();
        elements.findInput.select();
      }
    } else if (event.key === "F3") {
      event.preventDefault();
      moveSearch(event.shiftKey ? -1 : 1);
    } else if (event.key === "F5" || (mod && !event.altKey && !event.shiftKey && key === "r")) {
      event.preventDefault();
      post({ type: "reload" });
    } else if (mod && event.shiftKey && !event.altKey && key === "t") {
      event.preventDefault();
      cycleTheme();
    } else if (mod && event.shiftKey && !event.altKey && key === "v" && !inFind) {
      event.preventDefault();
      if (displayed) {
        setView(currentView === "page" ? "reading" : "page", true);
      }
    } else if (mod && event.shiftKey && !event.altKey && key === "e") {
      event.preventDefault();
      openInEditor();
    } else if (mod && event.shiftKey && !event.altKey && key === "c") {
      event.preventDefault();
      copyAll();
    } else if (event.ctrlKey && event.key === "Tab") {
      if (tabs.length > 1) {
        event.preventDefault();
        cycleTab(event.shiftKey ? -1 : 1);
      }
    } else if (event.ctrlKey && (event.key === "PageDown" || event.key === "PageUp")) {
      if (tabs.length > 1) {
        event.preventDefault();
        cycleTab(event.key === "PageDown" ? 1 : -1);
      }
    } else if (mod && !event.shiftKey && !event.altKey && key === "w") {
      if (host.tabs && idKey(activeTabId) !== "") {
        event.preventDefault();
        closeTab(activeTabId);
      }
    } else if (mod && !event.shiftKey && !event.altKey && /^[1-9]$/.test(event.key)) {
      if (tabs.length > 1) {
        event.preventDefault();
        var target = event.key === "9" ? tabs[tabs.length - 1] : tabs[Number(event.key) - 1];
        if (target) {
          selectTab(target.id, false);
        }
      }
    } else if (mod && !event.altKey && (event.key === "+" || event.key === "=")) {
      event.preventDefault();
      stepZoom(1);
    } else if (mod && !event.altKey && (event.key === "-" || event.key === "_")) {
      event.preventDefault();
      stepZoom(-1);
    } else if (mod && !event.altKey && event.key === "0") {
      event.preventDefault();
      resetZoom();
    }
  });

  window.addEventListener("resize", function () {
    if (resizeFrame) {
      return;
    }
    resizeFrame = window.requestAnimationFrame(function () {
      resizeFrame = 0;
      if (displayed && zoomMode !== "fixed") {
        applyZoom(true);
      }
    });
  });
  if (systemTheme.addEventListener) {
    systemTheme.addEventListener("change", function () {
      applyTheme(currentTheme);
    });
  }

  // Hosts deliver messages in any of three equivalent ways (see
  // tests/reader/README.md): a "leandoc-message" event whose detail is the
  // message, LeanDocHost.receive(message), or WebView2 PostWebMessageAsJson.
  window.addEventListener("leandoc-message", function (event) {
    handleHostMessage(event.detail);
  });
  if (webView2Bridge && webView2Bridge.addEventListener) {
    webView2Bridge.addEventListener("message", function (event) {
      handleHostMessage(event.data);
    });
  }
  window.LeanDocHost = Object.freeze({
    receive: function (message) {
      handleHostMessage(message);
    }
  });

  applyTheme("system");
  updateShortcutTitles();
  setControlsEnabled(false);
  root.dataset.renderState = "empty";
  if (!window.docx || !Fixups || !Wording) {
    root.dataset.renderState = "failed";
    showStatus("LeanDoc could not load its document renderer.", "error");
  }
  post({ type: "ready" });
}());
