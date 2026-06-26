(function () {
  const CACHE_NAME = 'dessin-3d-modeles-v1';
  const objectUrls = new Map();
  const pendingUrls = new Map();

  // Le mode aperçu fixe est réservé aux vrais téléphones, pas aux iPad ni aux
  // ordinateurs tactiles. L'iPad Safari contient souvent « Mobile » dans son
  // user-agent : on ne teste donc jamais ce mot seul.
  const isPhone = Boolean(navigator.userAgentData?.mobile) ||
    /iPhone|iPod|Android.*Mobile|Windows Phone|IEMobile|Opera Mini/i.test(navigator.userAgent);
  const useStaticMobilePreviews = isPhone;

  /*
   * En mode téléphone, les aperçus dans la galerie sont fixes. Les vrais
   * model-viewer restent réservés à la fenêtre Zoom, qui n'ouvre qu'un modèle
   * à la fois. Cela empêche Safari de créer/détruire plusieurs contextes WebGL
   * quand la page est scrollée rapidement.
   */
  function enableStaticMobilePreviews() {
    if (!useStaticMobilePreviews || !('IntersectionObserver' in window)) return;

    const NativeIntersectionObserver = window.IntersectionObserver;
    if (NativeIntersectionObserver.__dessin3dStaticMobilePreviews) return;
    NativeIntersectionObserver.__dessin3dStaticMobilePreviews = true;

    function isInlineModel(target) {
      return Boolean(
        target &&
        target.classList &&
        target.classList.contains('inline-model')
      );
    }

    function StaticPreviewObserver(callback, options) {
      return new NativeIntersectionObserver((entries, observer) => {
        // Le script de 3D.html utilise ce type d'entrée pour monter puis
        // démonter les aperçus de galerie. On les bloque uniquement sur petit
        // écran afin de ne jamais déclencher ces cycles pendant le scroll.
        const safeEntries = entries.filter((entry) => !isInlineModel(entry.target));
        if (safeEntries.length) callback(safeEntries, observer);
      }, options);
    }

    StaticPreviewObserver.prototype = NativeIntersectionObserver.prototype;
    Object.setPrototypeOf(StaticPreviewObserver, NativeIntersectionObserver);
    window.IntersectionObserver = StaticPreviewObserver;

    window.addEventListener('load', () => {
      // 3D.html construit la galerie dans son propre gestionnaire onload.
      // Ce timeout s'exécute juste après afin de remplacer les aperçus mobiles.
      window.setTimeout(() => {
        const style = document.createElement('style');
        style.textContent = `
          .inline-model.mobile-static-preview .mobile-static-image,
          .inline-model.mobile-static-preview .mobile-static-placeholder {
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
            z-index: 1;
          }
          .inline-model.mobile-static-preview .mobile-static-image {
            object-fit: contain;
            padding: 10px;
            box-sizing: border-box;
            background: #1e2937;
          }
          .inline-model.mobile-static-preview .mobile-static-placeholder {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 10px;
            color: #c7d2fe;
            font-weight: 800;
            text-align: center;
            padding: 24px;
            box-sizing: border-box;
            background: radial-gradient(circle at center, #334155 0%, #1e2937 68%);
          }
          .inline-model.mobile-static-preview .mobile-static-placeholder i {
            font-size: 2.25rem;
            color: #818cf8;
          }
          .inline-model.mobile-static-preview .inline-model-loader {
            display: none;
          }
          .inline-model.mobile-static-preview .inline-model-hint {
            display: inline-flex;
            z-index: 4;
            pointer-events: none;
          }
          .inline-model.mobile-static-preview .zoom-action {
            z-index: 6;
          }
        `;
        document.head.appendChild(style);

        const fallbackPreviews = {
          '3D%20MODEL/super-heros.glb': '3D%20MODEL/super-hero.png'
        };

        document.querySelectorAll('.inline-model').forEach((container) => {
          const card = container.closest('.creation-card');
          const sourceImages = card ? Array.from(card.querySelectorAll('.demarche-img')) : [];
          const latestImage = sourceImages[sourceImages.length - 1];
          const previewSource = latestImage?.currentSrc || latestImage?.src || fallbackPreviews[container.dataset.glb];

          // Le premier aperçu peut avoir été créé pendant initInlineModels().
          // On le retire aussitôt : en mobile, l'affichage dans la carte reste
          // une image fixe et Zoom conserve le vrai lecteur 3D interactif.
          const inlineViewer = container.querySelector(':scope > model-viewer');
          if (inlineViewer) {
            inlineViewer.removeAttribute('src');
            inlineViewer.remove();
          }

          container.classList.add('mobile-static-preview', 'active', 'loaded');
          container.dataset.staticPreview = 'true';
          delete container.dataset.viewerReady;
          delete container.dataset.loadToken;

          const hint = container.querySelector('.inline-model-hint');
          if (hint) {
            hint.innerHTML = '<i class="fa-solid fa-cube"></i> Aperçu fixe';
          }

          if (previewSource) {
            const image = document.createElement('img');
            image.className = 'mobile-static-image';
            image.src = previewSource;
            image.alt = container.dataset.alt || 'Aperçu fixe du modèle 3D';
            image.loading = 'lazy';
            container.insertBefore(image, container.firstChild);
          } else {
            const placeholder = document.createElement('div');
            placeholder.className = 'mobile-static-placeholder';
            placeholder.innerHTML = '<i class="fa-solid fa-cube"></i><span>Aperçu 3D fixe<br>Appuie sur Zoom pour le manipuler</span>';
            container.insertBefore(placeholder, container.firstChild);
          }
        });
      }, 0);
    });
  }

  enableStaticMobilePreviews();

  // Un fetch sans limite peut rester suspendu indéfiniment (réseau iOS
  // capricieux), ce qui figerait la promesse en cache et bloquerait le modèle
  // à 0 % pour toujours. On borne donc chaque téléchargement dans le temps.
  function fetchWithTimeout(url, ms) {
    if (typeof AbortController === 'undefined') return fetch(url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
  }

  async function resolve(source) {
    if (!source) return source;

    const absoluteUrl = new URL(source, document.baseURI).href;
    if (objectUrls.has(absoluteUrl)) return objectUrls.get(absoluteUrl);
    if (pendingUrls.has(absoluteUrl)) return pendingUrls.get(absoluteUrl);

    const pending = (async () => {
      try {
        let response;

        if ('caches' in window) {
          const cache = await caches.open(CACHE_NAME);
          response = await cache.match(absoluteUrl);

          if (!response) {
            response = await fetchWithTimeout(absoluteUrl, 20000);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            try {
              await cache.put(absoluteUrl, response.clone());
            } catch (cacheError) {
              // Un quota trop faible ne doit pas provoquer un second
              // téléchargement : on garde tout de même la réponse en mémoire.
              console.warn(`[3D cache] Stockage persistant indisponible pour ${source}`, cacheError);
            }
          } else if (!(await isUsableModelResponse(response, absoluteUrl))) {
            await cache.delete(absoluteUrl);
            response = await fetchWithTimeout(absoluteUrl, 20000);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            try {
              await cache.put(absoluteUrl, response.clone());
            } catch (cacheError) {
              console.warn(`[3D cache] Stockage persistant indisponible pour ${source}`, cacheError);
            }
          }
        } else {
          response = await fetchWithTimeout(absoluteUrl, 20000);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
        }

        const objectUrl = URL.createObjectURL(await response.blob());
        objectUrls.set(absoluteUrl, objectUrl);
        return objectUrl;
      } catch (error) {
        console.warn(`[3D cache] Impossible de mettre ${source} en cache`, error);
        return source;
      } finally {
        pendingUrls.delete(absoluteUrl);
      }
    })();

    pendingUrls.set(absoluteUrl, pending);
    return pending;
  }

  async function isUsableModelResponse(response, absoluteUrl) {
    try {
      const blob = await response.clone().blob();
      if (blob.size < 1024) return false;
      if (!/\.glb(?:[?#].*)?$/i.test(absoluteUrl)) return true;

      const header = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
      return header[0] === 0x67 && header[1] === 0x6c && header[2] === 0x54 && header[3] === 0x46;
    } catch (error) {
      console.warn(`[3D cache] Réponse cache illisible pour ${absoluteUrl}`, error);
      return false;
    }
  }

  async function invalidate(source) {
    if (!source) return;

    const absoluteUrl = new URL(source, document.baseURI).href;
    release(source);
    pendingUrls.delete(absoluteUrl);

    if ('caches' in window) {
      try {
        const cache = await caches.open(CACHE_NAME);
        await cache.delete(absoluteUrl);
      } catch (error) {
        console.warn(`[3D cache] Impossible d'effacer ${source} du cache`, error);
      }
    }
  }

  function release(source) {
    if (!source) return;

    const absoluteUrl = new URL(source, document.baseURI).href;
    const objectUrl = objectUrls.get(absoluteUrl);
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrls.delete(absoluteUrl);
  }

  window.ModelAssetCache = { resolve, invalidate, release };
})();
