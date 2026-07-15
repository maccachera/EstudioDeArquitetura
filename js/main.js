/* ========================================================================== 
   COTA ZERO — motor de scroll-scrubbing

   O vídeo é amostrado uma única vez e os frames decodificados ficam prontos
   em memória. Durante o scroll, o canvas apenas compõe duas imagens vizinhas,
   o que elimina os degraus visuais de uma sequência discreta sem fazer seek
   no vídeo a cada evento de rolagem.
   ========================================================================== */

(() => {
  "use strict";

  /* ---------- direção de arte e qualidade -------------------------------- */
  const FRAME_COUNT = 80;
  const FRAME_W = 1024;
  const FRAME_H = 576;
  const PREVIEW_STRIDE = 16;
  const PREVIEW_FRAMES_PER_SOURCE = Math.ceil(
    (FRAME_COUNT - 1) / PREVIEW_STRIDE
  ) + 1;

  const FADE_START = 0.32;
  const FADE_END = 0.40;
  const SPLIT_START = 0.86;
  const SPLIT_END = 0.93;
  const COTA_MAX = 7.5;
  const FOLLOW_RATE = 26; // resposta em segundos; independe da taxa do monitor

  /* ---------- elementos --------------------------------------------------- */
  const film = document.querySelector("[data-film]");
  const videoA = document.querySelector("[data-video-a]");
  const videoB = document.querySelector("[data-video-b]");
  const canvas = document.querySelector("[data-canvas]");
  const seam = document.querySelector("[data-seam]");
  const caps = [...document.querySelectorAll("[data-cap]")];
  const gauge = document.querySelector("[data-gauge]");
  const gMarker = document.querySelector("[data-gauge-marker]");
  const gCota = document.querySelector("[data-gauge-cota]");
  const loading = document.querySelector("[data-loading]");

  if (!film || !videoA || !videoB || !canvas) return;

  /* ---------- perfil de movimento ----------------------------------------
     Em telas de toque o vídeo contínuo é mais leve e previsível. Pessoas que
     pedem menos movimento recebem um still, sem autoplay nem scrub. */
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const isTouchLayout = matchMedia("(pointer: coarse)").matches ||
    (navigator.maxTouchPoints > 0 && innerWidth <= 820);
  const mode = reducedMotion ? "static" : isTouchLayout ? "simple" : "scrub";
  document.documentElement.classList.add(`mode-${mode}`);

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const once = (element, event) => new Promise((resolve, reject) => {
    const onEvent = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error(`Falha ao carregar ${element.currentSrc || element.src}`));
    };
    const cleanup = () => {
      element.removeEventListener(event, onEvent);
      element.removeEventListener("error", onError);
    };
    element.addEventListener(event, onEvent, { once: true });
    element.addEventListener("error", onError, { once: true });
  });
  const smoothstep = (from, to, value) => {
    const t = clamp((value - from) / (to - from), 0, 1);
    return t * t * (3 - 2 * t);
  };

  if (mode !== "scrub") {
    if (mode === "simple") {
      videoA.loop = true;
      videoA.play().catch(() => { /* autoplay pode ser bloqueado */ });
    } else if (videoA.readyState >= 1) {
      videoA.currentTime = videoA.duration * 0.55;
    } else {
      videoA.addEventListener("loadedmetadata", () => {
        videoA.currentTime = videoA.duration * 0.55;
      }, { once: true });
    }
    return;
  }

  /* ========================================================================
     CANVAS — composição temporal + transições
     ======================================================================== */
  const framesA = new Array(FRAME_COUNT).fill(null);
  const framesB = new Array(FRAME_COUNT).fill(null);
  const ctx = canvas.getContext("2d", { alpha: true, desynchronized: true });
  const mixCanvas = document.createElement("canvas");
  const mixCtx = mixCanvas.getContext("2d", { alpha: true });

  let W = 0;
  let H = 0;
  let doneCount = 0;
  let previewDone = 0;
  let needsRedraw = true;
  let lastRenderKey = "";

  function configureContext(context) {
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
  }

  function resizeCanvas() {
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);

    // Não há ganho em rasterizar acima da resolução da fonte; isso reduz
    // bastante o custo de composição em telas retina.
    const usefulDpr = Math.max(1, Math.min(
      devicePixelRatio || 1,
      Math.max(FRAME_W / width, FRAME_H / height)
    ));

    W = canvas.width = mixCanvas.width = Math.round(width * usefulDpr);
    H = canvas.height = mixCanvas.height = Math.round(height * usefulDpr);
    configureContext(ctx);
    configureContext(mixCtx);
    needsRedraw = true;
    lastRenderKey = "";
  }

  function drawCover(context, image) {
    const scale = Math.max(W / image.width, H / image.height);
    const sourceW = W / scale;
    const sourceH = H / scale;
    context.drawImage(
      image,
      (image.width - sourceW) / 2,
      (image.height - sourceH) / 2,
      sourceW,
      sourceH,
      0,
      0,
      W,
      H
    );
  }

  function nearest(store, index) {
    if (store[index]) return store[index];
    for (let distance = 1; distance < FRAME_COUNT; distance++) {
      if (index - distance >= 0 && store[index - distance]) {
        return store[index - distance];
      }
      if (index + distance < FRAME_COUNT && store[index + distance]) {
        return store[index + distance];
      }
    }
    return null;
  }

  /* Compõe o frame anterior e o seguinte em um buffer. Essa interpolação
     óptica simples é o detalhe que faz a sequência acompanhar trackpads de
     alta resolução sem revelar cada troca de bitmap. */
  function composeFrame(store, position) {
    const beforeIndex = Math.floor(position);
    const afterIndex = Math.min(FRAME_COUNT - 1, beforeIndex + 1);
    const amount = position - beforeIndex;
    const before = nearest(store, beforeIndex);
    const after = nearest(store, afterIndex);

    mixCtx.clearRect(0, 0, W, H);
    if (!before && !after) return false;

    const base = before || after;
    drawCover(mixCtx, base);
    if (after && after !== base && amount > 0.001) {
      mixCtx.globalAlpha = amount;
      drawCover(mixCtx, after);
      mixCtx.globalAlpha = 1;
    }
    return true;
  }

  function paintSequence(store, position, alpha = 1) {
    if (!composeFrame(store, position)) return false;
    ctx.globalAlpha = alpha;
    ctx.drawImage(mixCanvas, 0, 0);
    ctx.globalAlpha = 1;
    return true;
  }

  function draw(progress) {
    const framePosition = progress * (FRAME_COUNT - 1);
    const fade = smoothstep(FADE_START, FADE_END, progress);
    const split = smoothstep(SPLIT_START, SPLIT_END, progress);
    const renderKey = [
      framePosition.toFixed(3),
      fade.toFixed(3),
      split.toFixed(3),
      doneCount,
      W,
      H,
    ].join("|");

    if (renderKey === lastRenderKey && !needsRedraw) return;
    lastRenderKey = renderKey;
    needsRedraw = false;
    ctx.clearRect(0, 0, W, H);

    if (split > 0) {
      // O recorte nasce fora da tela à esquerda. Assim o plano B, que já
      // ocupava tudo, revela A sem nenhum corte na entrada da transição.
      const hasA = paintSequence(framesA, framePosition);
      if (!hasA) paintSequence(framesB, framePosition);

      ctx.save();
      ctx.beginPath();
      ctx.rect(W * 0.5 * split, 0, W, H);
      ctx.clip();
      paintSequence(framesB, framePosition);
      ctx.restore();
    } else {
      const hasA = paintSequence(framesA, framePosition);
      if (fade > 0) {
        paintSequence(framesB, framePosition, hasA ? fade : 1);
      } else if (!hasA) {
        paintSequence(framesB, framePosition);
      }
    }

    seam.style.opacity = split.toFixed(3);
    seam.style.left = `${50 * split}%`;
  }

  resizeCanvas();
  if ("ResizeObserver" in window) {
    new ResizeObserver(resizeCanvas).observe(canvas);
  } else {
    addEventListener("resize", resizeCanvas, { passive: true });
  }

  /* ========================================================================
     SCROLL — resposta curta, estável em 60/120/144 Hz e sem loop permanente
     ======================================================================== */
  let target = 0;
  let current = 0;
  let viewportH = innerHeight;
  let rafId = null;
  let lastTick = 0;
  let isActive = false;
  let hasActivated = false;

  function readProgress() {
    const rect = film.getBoundingClientRect();
    return clamp(
      (-rect.top - viewportH) / Math.max(1, film.offsetHeight - 2 * viewportH),
      0,
      1
    );
  }

  function apply(progress) {
    draw(progress);

    for (const cap of caps) {
      const from = Number(cap.dataset.from);
      const to = Number(cap.dataset.to);
      const edge = (to - from) * 0.15;
      const enters = smoothstep(from, from + edge, progress);
      const leaves = to >= 1 ? 1 : 1 - smoothstep(to - edge, to, progress);
      const opacity = Math.min(enters, leaves);
      const centered = cap.classList.contains("cap--4")
        ? "translate(-50%, -40%) "
        : "";

      cap.style.opacity = opacity.toFixed(3);
      cap.style.transform = `${centered}translateY(${(1 - opacity) * 18}px)`;
    }

    if (gMarker && gCota) {
      gMarker.style.top = `${(1 - progress) * 100}%`;
      gCota.textContent = `+${(progress * COTA_MAX)
        .toFixed(2)
        .replace(".", ",")} m`;
    }

    const rect = film.getBoundingClientRect();
    gauge?.classList.toggle(
      "is-visible",
      -rect.top > viewportH * 0.5 && rect.bottom > viewportH
    );
  }

  function requestTick() {
    if (isActive && rafId === null) {
      rafId = requestAnimationFrame(tick);
    }
  }

  function tick(time) {
    rafId = null;
    const elapsed = lastTick ? Math.min((time - lastTick) / 1000, 0.05) : 1 / 60;
    lastTick = time;
    target = readProgress();

    // Amortecimento exponencial: resposta idêntica em qualquer refresh rate.
    const distance = Math.abs(target - current);
    const follow = 1 - Math.exp(-FOLLOW_RATE * elapsed);
    current = distance > 0.12
      ? target // saltos de âncora/página não ficam tentando alcançar o scroll
      : current + (target - current) * follow;
    if (Math.abs(target - current) < 0.00015) current = target;

    apply(current);
    if (current !== target || needsRedraw) requestTick();
  }

  function onViewportChange() {
    viewportH = innerHeight;
    target = readProgress();
    requestTick();
  }

  addEventListener("scroll", onViewportChange, { passive: true });
  addEventListener("resize", onViewportChange, { passive: true });

  const watcher = new IntersectionObserver(([entry]) => {
    isActive = entry.isIntersecting;
    if (isActive) {
      target = readProgress();
      if (!hasActivated) current = target;
      hasActivated = true;
      lastTick = 0;
      requestTick();
    } else {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = null;
      lastTick = 0;
      gauge?.classList.remove("is-visible");
    }
  }, { rootMargin: "20% 0px" });
  watcher.observe(film);

  /* ========================================================================
     EXTRAÇÃO PROGRESSIVA

     Primeiro extraímos uma malha de preview ao longo de toda a duração;
     depois preenchemos os intervalos. Se alguém rolar imediatamente, sempre
     existe uma imagem temporalmente próxima em vez de uma tela vazia.
     ======================================================================== */
  function extractionOrder() {
    const order = [];
    const included = new Set();
    const add = (index) => {
      if (!included.has(index)) {
        included.add(index);
        order.push(index);
      }
    };

    for (let index = 0; index < FRAME_COUNT; index += PREVIEW_STRIDE) add(index);
    add(FRAME_COUNT - 1);
    for (let index = 0; index < FRAME_COUNT; index++) add(index);
    return order;
  }

  async function waitForSeek(video, time) {
    if (Math.abs(video.currentTime - time) < 0.0005 && video.readyState >= 2) {
      return true;
    }

    const presented = "requestVideoFrameCallback" in video
      ? new Promise((resolve) => {
          video.requestVideoFrameCallback((_now, metadata) => {
            resolve(Math.abs(metadata.mediaTime - time) < 0.18);
          });
        })
      : Promise.resolve(true);

    const seeked = new Promise((resolve) => {
      let timer;
      const cleanup = () => {
        clearTimeout(timer);
        video.removeEventListener("seeked", onSeeked);
        video.removeEventListener("error", onError);
      };
      const onSeeked = () => {
        cleanup();
        resolve(true);
      };
      const onError = () => {
        cleanup();
        resolve(false);
      };

      video.addEventListener("seeked", onSeeked, { once: true });
      video.addEventListener("error", onError, { once: true });
      timer = setTimeout(() => {
        cleanup();
        resolve(false);
      }, 1800);
      video.currentTime = time;
    });

    if (!await seeked) return false;
    return Promise.race([
      presented,
      delay(600).then(() => false),
    ]);

  }

  function updateLoading(isPreview) {
    if (!isPreview) return;
    previewDone++;
    const percent = Math.round(
      (previewDone / (PREVIEW_FRAMES_PER_SOURCE * 2)) * 100
    );
    loading?.style.setProperty("--load", `${percent}%`);
    if (percent >= 100) loading?.classList.add("is-done");
  }

  async function prepareSource(video) {
    try {
      const response = await fetch(video.currentSrc || video.src);
      if (response.ok) {
        const objectUrl = URL.createObjectURL(await response.blob());
        video.dataset.objectUrl = objectUrl;
        video.src = objectUrl;
        video.load();
      }
    } catch {
      // file:// e políticas locais podem impedir fetch; o src original segue.
    }

    if (video.readyState < 1) await once(video, "loadedmetadata");
    if (video.readyState < 2) await once(video, "loadeddata");
  }

  function releaseSource(video) {
    const objectUrl = video.dataset.objectUrl;
    video.removeAttribute("src");
    video.load();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    video.style.display = "none";
  }

  async function extract(video, store) {
    await prepareSource(video);
    const duration = Math.max(0.001, video.duration - 0.06);
    let extractedCount = 0;
    const buffer = document.createElement("canvas");
    buffer.width = FRAME_W;
    buffer.height = FRAME_H;
    const bufferContext = buffer.getContext("2d", { alpha: false });
    configureContext(bufferContext);

    const order = extractionOrder();
    for (let orderIndex = 0; orderIndex < order.length; orderIndex++) {
      const frameIndex = order[orderIndex];
      const isPreview = orderIndex < PREVIEW_FRAMES_PER_SOURCE;
      const time = Math.max(0.001, (frameIndex / (FRAME_COUNT - 1)) * duration);
      const isPresented = await waitForSeek(video, time);

      if (!isPresented) {
        doneCount++;
        updateLoading(isPreview);
        continue;
      }

      bufferContext.drawImage(video, 0, 0, FRAME_W, FRAME_H);

      store[frameIndex] = "createImageBitmap" in window
        ? await createImageBitmap(buffer)
        : (() => {
            const fallback = document.createElement("canvas");
            fallback.width = FRAME_W;
            fallback.height = FRAME_H;
            fallback.getContext("2d").drawImage(buffer, 0, 0);
            return fallback;
          })();

      extractedCount++;
      doneCount++;
      needsRedraw = true;
      updateLoading(isPreview);
      requestTick();

      // A decodificação nunca monopoliza uma sequência inteira de frames.
      if (orderIndex % 4 === 3) await new Promise(requestAnimationFrame);
    }

    if (extractedCount > 0) releaseSource(video);
  }

  Promise.allSettled([
    extract(videoA, framesA),
    extract(videoB, framesB),
  ]).then((results) => {
    if (results.some((result) => result.status === "rejected")) {
      loading?.classList.add("is-done");
    }
  });

  addEventListener("pagehide", () => {
    for (const frame of [...framesA, ...framesB]) frame?.close?.();
  }, { once: true });

  // Hook pequeno para inspeção e testes locais.
  window.__cotaZero = {
    apply: (progress) => apply(clamp(progress, 0, 1)),
    framesReady: () => doneCount,
    progress: () => ({ target, current }),
  };
})();
