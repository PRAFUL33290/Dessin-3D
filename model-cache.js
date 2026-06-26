(function () {
  const CACHE_NAME = 'dessin-3d-modeles-v1';
  const objectUrls = new Map();
  const pendingUrls = new Map();
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  /*
   * Correctif Safari/iPad : model-viewer crée des contextes WebGL. La page
   * galerie détruit et recrée ces contextes pendant un scroll rapide, ce qui
   * peut faire fermer Safari. Sur iOS, on conserve seulement le premier aperçu
   * 3D dans la galerie. Les autres créations restent accessibles avec Zoom,
   * qui ouvre un seul modèle plein écran à la fois.
   */
  function makeIOSGalleryScrollSafe() {
    if (!isIOS || !('IntersectionObserver' in window)) return;

    const NativeIntersectionObserver = window.IntersectionObserver;
    if (NativeIntersectionObserver.__dessin3dIOSGallerySafe) return;
    NativeIntersectionObserver.__dessin3dIOSGallerySafe = true;

    function isInlineModel(target) {
      return Boolean(
        target &&
        target.classList &&
        target.classList.contains('inline-model')
      );
    }

    function SafeIntersectionObserver(callback, options) {
      return new NativeIntersectionObserver((entries, observer) => {
        // 3D.html utilise cet observer uniquement pour créer/supprimer les
        // aperçus de galerie. En ne transmettant pas ces entrées sur iOS,
        // seuls le premier aperçu et les modèles ouverts avec Zoom sont créés.
        const safeEntries = entries.filter((entry) => !isInlineModel(entry.target));
        if (safeEntries.length) callback(safeEntries, observer);
      }, options);
    }

    SafeIntersectionObserver.prototype = NativeIntersectionObserver.prototype;
    Object.setPrototypeOf(SafeIntersectionObserver, NativeIntersectionObserver);
    window.IntersectionObserver = SafeIntersectionObserver;

    window.addEventListener('load', () => {
      window.setTimeout(() => {
        const models = Array.from(document.querySelectorAll('.inline-model'));

        // Le premier est chargé par 3D.html pour garder un aperçu visible en
        // haut de la page. Tous les autres affichent une indication claire.
        models.slice(1).forEach((container) => {
          const loaderText = container.querySelector('.inline-model-loader-text');
          const spinner = container.querySelector('.inline-model-spinner');
          const hint = container.querySelector('.inline-model-hint');

          container.classList.add('active');
          if (loaderText) loaderText.textContent = 'Appuie sur Zoom pour voir ce modèle en 3D';
          if (spinner) spinner.style.display = 'none';
          if (hint) hint.style.display = 'none';
        });
      }, 0);
    });
  }

  makeIOSGalleryScrollSafe();

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
