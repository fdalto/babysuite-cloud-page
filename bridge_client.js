(() => {
  const BRIDGE_ORIGIN = "http://127.0.0.1:8099";
  const UPLOAD_ENDPOINT_KEY = "bridge_print_upload_endpoint";
  const MAX_PRINT_IMAGES = 200;

  const printGridEl = document.getElementById("printGrid");
  const printStatusEl = document.getElementById("print-status");
  const sendBtnEl = document.getElementById("btnSendPrintImages");
  const clearBtnEl = document.getElementById("btnClearPrintImages");
  const endpointInputEl = document.getElementById("printUploadEndpoint");

  window.__CURRENT_SR__ = window.__CURRENT_SR__ || null;
  window.__LAST_IMAGE__ = window.__LAST_IMAGE__ || null;
  window.__LAST_BRIDGE_METADATA__ = window.__LAST_BRIDGE_METADATA__ || null;
  window.__BRIDGE_PRINT_IMAGES__ = window.__BRIDGE_PRINT_IMAGES__ || [];

  function setPrintStatus(text) {
    if (printStatusEl) printStatusEl.textContent = text;
  }

  function getEndpoint() {
    return (endpointInputEl?.value || "").trim();
  }

  function persistEndpoint() {
    if (!endpointInputEl) return;
    const url = getEndpoint();
    if (url) {
      localStorage.setItem(UPLOAD_ENDPOINT_KEY, url);
    } else {
      localStorage.removeItem(UPLOAD_ENDPOINT_KEY);
    }
  }

  function formatTimestamp(ts) {
    try {
      return new Date(ts).toLocaleString("pt-BR");
    } catch (_) {
      return String(ts);
    }
  }

  function summarizeMetadata(metadata) {
    if (!metadata || typeof metadata !== "object") return "sem metadata";
    const modality = metadata.Modality || metadata.modality || "?";
    const patient = metadata.PatientName || metadata.patient_name || metadata.PatientID || metadata.patient_id || "-";
    const study = metadata.StudyInstanceUID || metadata.study_instance_uid || "-";
    return `Mod: ${modality} | Paciente: ${patient} | Study: ${study}`;
  }

  function renderPrintImages() {
    if (!printGridEl) return;

    printGridEl.innerHTML = "";
    const items = window.__BRIDGE_PRINT_IMAGES__;

    if (!items.length) {
      setPrintStatus("Nenhuma imagem recebida ainda.");
      return;
    }

    setPrintStatus(`Imagens em memória: ${items.length}`);

    items.forEach((item) => {
      const card = document.createElement("article");
      card.className = "print-card";

      const img = document.createElement("img");
      img.loading = "lazy";
      img.src = item.objectUrl;
      img.alt = item.message_id || "dicom image";

      const meta = document.createElement("div");
      meta.className = "print-meta";
      meta.textContent = `${formatTimestamp(item.ts)} | ${summarizeMetadata(item.metadata)}`;

      card.appendChild(img);
      card.appendChild(meta);
      printGridEl.appendChild(card);
    });
  }

  function addImageToMemory(messageId, metadata, pngBuffer) {
    const blob = new Blob([pngBuffer], { type: "image/png" });
    const objectUrl = URL.createObjectURL(blob);
    const item = {
      message_id: messageId || String(Date.now()),
      ts: Date.now(),
      metadata: metadata || {},
      png_buffer: pngBuffer,
      objectUrl,
    };

    window.__BRIDGE_PRINT_IMAGES__.push(item);

    if (window.__BRIDGE_PRINT_IMAGES__.length > MAX_PRINT_IMAGES) {
      const removed = window.__BRIDGE_PRINT_IMAGES__.shift();
      if (removed?.objectUrl) URL.revokeObjectURL(removed.objectUrl);
    }

    window.__LAST_IMAGE__ = item;
    renderPrintImages();
  }

  function clearImagesFromMemory() {
    const items = window.__BRIDGE_PRINT_IMAGES__;
    items.forEach((item) => {
      if (item?.objectUrl) URL.revokeObjectURL(item.objectUrl);
    });
    window.__BRIDGE_PRINT_IMAGES__ = [];
    renderPrintImages();
  }

  async function sendImagesToEndpoint() {
    const endpoint = getEndpoint();
    const items = window.__BRIDGE_PRINT_IMAGES__;

    if (!endpoint) {
      setPrintStatus("Defina o endpoint de envio antes de enviar as imagens.");
      return;
    }

    if (!items.length) {
      setPrintStatus("Sem imagens em memória para enviar.");
      return;
    }

    const formData = new FormData();
    const metadataList = [];

    items.forEach((item, idx) => {
      const fileName = `${item.message_id || `img_${idx + 1}`}.png`;
      const blob = new Blob([item.png_buffer], { type: "image/png" });
      formData.append("files", blob, fileName);
      metadataList.push({
        message_id: item.message_id,
        ts: item.ts,
        metadata: item.metadata || {},
      });
    });

    formData.append("metadata_json", JSON.stringify(metadataList));

    setPrintStatus(`Enviando ${items.length} imagem(ns)...`);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      setPrintStatus(`Envio concluído: ${items.length} imagem(ns) para ${endpoint}`);
    } catch (error) {
      setPrintStatus(`Falha no envio: ${error.message}`);
    }
  }

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
        addImageToMemory(data.message_id, data.metadata, pngBuffer);
      }

      window.__LAST_BRIDGE_METADATA__ = data.metadata || null;
      postAck(data.message_id);
    }
  });

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

  if (endpointInputEl) {
    endpointInputEl.value = localStorage.getItem(UPLOAD_ENDPOINT_KEY) || "";
    endpointInputEl.addEventListener("change", persistEndpoint);
    endpointInputEl.addEventListener("blur", persistEndpoint);
  }

  if (sendBtnEl) {
    sendBtnEl.addEventListener("click", sendImagesToEndpoint);
  }

  if (clearBtnEl) {
    clearBtnEl.addEventListener("click", clearImagesFromMemory);
  }

  renderPrintImages();
  setInterval(publishIfChanged, 800);
  window.addEventListener("DOMContentLoaded", publishIfChanged);
})();
