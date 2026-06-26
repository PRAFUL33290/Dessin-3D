(function () {
  const CACHE_NAME = 'dessin-3d-modeles-v1';
  const objectUrls = new Map();
  const pendingUrls = new Map();
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  /*
   * Safari sur iPad/iPhone peut perdre son contexte WebGL lorsqu'un modèle est
   * détruit puis recréé pendant un scroll rapide. Sur iOS, on n'envoie donc à
   * la galerie qu'un seul nouveau modèle après 320 ms sans scroll. Les modèles
   * déjà ouverts restent en place : aucun va-et-vient création/destruction.
   */
  function stabilizeIOSGalleryScroll() {
    if (!isIOS || !('IntersectionObserver' in window)) return;

    const NativeIntersectionObserver = window.IntersectionObserver;
    if (NativeIntersectionObserver.__dessin3dIOSStable) return;
    NativeIntersectionObserver.__dessin3dIOSStable = true;

    function isInlineModel(target) {
      return Boolean(
        target &&
        target.classList &&
        target.classList.contains('inline-model')
      );
    }

    function StableIntersectionObserver(callback, options) {
      const states = new Map();
      const activated = new WeakSet();
      let settleTimer = null;

      function getClosestVisibleTarget() {
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
        const viewportCenter = viewportHeight / 2;
        let closest = null;
        let closestScore = Infinity;

        states.forEach((isIntersecting, target) => {
          if (!isIntersecting || !target.isConnected) return;

          const rect = target.getBoundingClientRect();
          const visible = rect.bottom > 0 && rect.top < viewportHeight;
          const center = rect.top + (rect.height / 2);
          const score = (visible ? 0 : 100000) + Math.abs(center - viewportCenter);

          if (score < closestScore) {
            closest = target;
            closestScore = score;
          }
        });

        return closest;
      }

      return new NativeIntersectionObserver((entries, observer) => {
        const standardEntries = [];
        let hasInlineChange = false;

        entries.forEach((entry) => {
          if (!isInlineModel(entry.target)) {
            standardEntries.push(entry);
            return;
          }

          hasInlineChange = true;
          states.set(entry.target, entry.isIntersecting);
        });

        if (standardEntries.length) callback(standardEntries, observer);
        if (!hasInlineChange) return;

        window.clearTimeout(settleTimer);
        settleTimer = window.setTimeout(() => {
          const target = getClosestVisibleTarget();
          if (!target || activated.has(target)) return;

          activated.add(target);
          // On ne transmet jamais la sortie d'une carte sur iOS : 3D.html ne
          // détruira donc pas le lecteur pendant un aller-retour de scroll.
          callback([{ target, isIntersecting: true }], observer);
        }, 320);
      }, options);
    }

    StableIntersectionObserver.prototype = NativeIntersectionObserver.prototype;
    Object.setPrototypeOf(StableIntersectionObserver, NativeIntersectionObserver);
    window.IntersectionObserver = StableIntersectionObserver;
  }

  stabilizeIOSGalleryScroll();

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

    // Les blob: URLs sont la source des erreurs de chargement visibles sur
    // Safari. model-viewer charge donc directement le .glb sur iPad/iPhone.
    if (isIOS) return source;

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
    if (isIOS) return;

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
    if (!source || isIOS) return;

    const absoluteUrl = new URL(source, document.baseURI).href;
    const objectUrl = objectUrls.get(absoluteUrl);
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrls.delete(absoluteUrl);
  }

  window.ModelAssetCache = { resolve, invalidate, release };
})();
