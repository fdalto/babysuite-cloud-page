(() => {
  const BRIDGE_ORIGIN = "http://127.0.0.1:8099";

  // Estado em memória para uso da UI cloud
  window.__CURRENT_SR__ = window.__CURRENT_SR__ || null;
  window.__LAST_IMAGE__ = window.__LAST_IMAGE__ || null;
  window.__LAST_BRIDGE_METADATA__ = window.__LAST_BRIDGE_METADATA__ || null;

  function postAck(messageId) {
    if (!messageId) return;
    window.parent.postMessage(
      {
        type: "ack",
        message_id: messageId,
      },
      BRIDGE_ORIGIN,
    );
  }

  function postSettingsUpdate() {
    window.parent.postMessage(
      {
        type: "settings_update",
        MODEL_ACTIVATED: window.modelActivated || {},
        ANALISE_CHOICE: window.analiseChoice || { tipo: "Ambos" },
      },
      BRIDGE_ORIGIN,
    );
  }

  window.addEventListener("message", (event) => {
    if (event.origin !== BRIDGE_ORIGIN) return;

    const data = event.data || {};

    if (data.type === "dicom_sr") {
      const srHtml = String(data.sr_html || "").trim();
      if (srHtml) {
        window.__CURRENT_SR__ = {
          id: data.message_id || String(Date.now()),
          sr_html: srHtml,
          ts: Date.now(),
          metadata: data.metadata || {},
        };
        if (typeof window.updateSRButtonState === "function") {
          window.updateSRButtonState();
        }
      }

      window.__LAST_BRIDGE_METADATA__ = data.metadata || null;
      postAck(data.message_id);
      return;
    }

    if (data.type === "dicom_image") {
      const pngBuffer = data.png_buffer;
      if (pngBuffer instanceof ArrayBuffer) {
        window.__LAST_IMAGE__ = {
          id: data.message_id || String(Date.now()),
          png_buffer: pngBuffer,
          ts: Date.now(),
          metadata: data.metadata || {},
        };
      }

      window.__LAST_BRIDGE_METADATA__ = data.metadata || null;
      postAck(data.message_id);
    }
  });

  // Publica settings periodicamente quando houver alteração.
  let lastSent = "";
  const publishIfChanged = () => {
    const snapshot = JSON.stringify({
      model: window.modelActivated || {},
      analise: window.analiseChoice || { tipo: "Ambos" },
    });

    if (snapshot === lastSent) return;
    lastSent = snapshot;
    postSettingsUpdate();
  };

  setInterval(publishIfChanged, 800);
  window.addEventListener("DOMContentLoaded", publishIfChanged);
})();
