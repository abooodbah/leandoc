// TEMPORARY stub reader for host development. Stream B replaces it.
// It implements just enough of the SPEC 4.3 bridge for --smoke-test.
(function () {
  "use strict";

  var webView2 = window.chrome && window.chrome.webview;
  var webKit = window.webkit && window.webkit.messageHandlers &&
    window.webkit.messageHandlers.leandoc;
  var main = document.getElementById("main");
  var bar = document.getElementById("bar");

  function post(message) {
    var text = JSON.stringify(message);
    if (webView2) {
      webView2.postMessage(text);
    } else if (webKit) {
      webKit.postMessage(text);
    }
  }

  function show(text) {
    main.textContent = "";
    var paragraph = document.createElement("p");
    paragraph.textContent = text;
    main.appendChild(paragraph);
  }

  function renderDocument(message) {
    var started = performance.now();
    bar.textContent = message.fileName || "LeanDoc";
    fetch(message.packageUrl).then(function (response) {
      if (!response.ok) {
        throw new Error("HTTP " + response.status);
      }
      return response.arrayBuffer();
    }).then(function (buffer) {
      main.textContent = "";
      var wrapper = document.createElement("div");
      wrapper.className = "docx-wrapper";
      var section = document.createElement("section");
      section.className = "docx";
      var paragraph = document.createElement("p");
      paragraph.textContent = "Stub render of " + message.fileName + ": " +
        buffer.byteLength + " bytes, kind " + message.report.kind + ".";
      section.appendChild(paragraph);
      wrapper.appendChild(section);
      main.appendChild(wrapper);
      document.documentElement.dataset.renderState = "rendered";
      post({
        type: "rendered",
        tab: message.tab,
        generation: message.generation,
        pages: 1,
        ms: Math.round(performance.now() - started)
      });
    }).catch(function (error) {
      show("The package could not be loaded: " + error.message);
      post({
        type: "renderFailed",
        tab: message.tab,
        generation: message.generation,
        message: String(error.message)
      });
    });
  }

  function receive(message) {
    if (!message || typeof message !== "object") {
      return;
    }
    if (message.type === "document") {
      renderDocument(message);
    } else if (message.type === "fallback") {
      bar.textContent = message.fileName || "LeanDoc";
      show("LeanDoc does not show this file (" + message.report.kind + ").");
    } else if (message.type === "empty") {
      bar.textContent = "LeanDoc";
      show("Read Word documents without opening an office suite.");
    } else if (message.type === "status") {
      bar.textContent = message.message;
    } else if (message.type === "host" && message.editor) {
      bar.title = message.editor.label;
    }
  }

  if (webView2) {
    webView2.addEventListener("message", function (event) {
      receive(event.data);
    });
  }
  window.addEventListener("leandoc-message", function (event) {
    receive(event.detail);
  });
  document.addEventListener("keydown", function (event) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "o") {
      event.preventDefault();
      post({ type: "open" });
    }
  });
  post({ type: "ready" });
}());
