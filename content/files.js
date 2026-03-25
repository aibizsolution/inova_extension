(function initContentFiles(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});

  function readTextFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("파일을 읽지 못했어요."));
      reader.onload = () => resolve(String(reader.result || ""));
      reader.readAsText(file, "utf-8");
    });
  }

  function downloadJson(filename, payload) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = sanitizeFilename(filename);
    document.body.appendChild(link);
    link.click();
    link.remove();
    global.setTimeout(() => URL.revokeObjectURL(href), 0);
  }

  function sanitizeFilename(filename) {
    return String(filename || "inova-prompts.json").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-");
  }

  namespace.contentFiles = {
    downloadJson,
    readTextFile,
  };
})(globalThis);
