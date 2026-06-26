(function () {
  const CACHE_NAME = 'dessin-3d-modeles-v1';
  const objectUrls = new Map();
  const pendingUrls = new Map();
  const releaseRequested = new Set();

  function isInlineModelTarget(target) {
    return Boolean(
      target &&
      target.classList &&
      target.classList.contains('inline-model')
    );
  }

  /*
   * La galerie crée un <model-viewer> lorsqu'une carte entre dans la zone du
   * scroll et le détruit lorsqu'elle en sort. Sur Safari/iOS, un aller-retour
   * rapide peut donc créer plusieurs contextes WebGL avant que les précédents
   * soient réellement libérés : la page finit alors blanche.
   *
   * On laisse le code de la galerie intact, mais on stabilise son observer :
   * - on attend 180 ms après le dernier mouvement de scroll ;
   * - on transmet seulement la carte la plus proche de l'écran ;
   * - on libère l'ancienne carte avant d'activer la suivante.
   *
   * Il n'y a donc jamais plus d'un modèle 3D de galerie actif à la fois.
   */
  function stabilizeMuseumScroll() {
    const isMuseumPage = /(?:^|\/)3d\.html$/i.test(window.location.pathname);
    if (!isMuseumPage || !('IntersectionObserver' in window)) return;

    const NativeIntersectionObserver = window.IntersectionObserver;
    if (NativeIntersectionObserver.__dessin3dMuseumStable) return;

    Object.defineProperty(NativeIntersectionObserver, '__dessin3dMuseumStable', {
      value: true,
      configurable: true
    });

    function StableIntersectionObserver(callback, options) {
      const states = new Map();
      let activeTarget = null;
      let settleTimer = null;

      function selectClosestVisibleModel() {
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
        const viewportCenter = viewportHeight / 2;
        let bestTarget = null;
        let bestScore = Infinity;

        states.forEach((isIntersecting, target) => {
          if (!isIntersecting || !target.isConnected) return;

          const rect = target.getBoundingClientRect();
          const isVisible = rect.bottom > 0 && rect.top < viewportHeight;
          const modelCenter = rect.top + (rect.height / 2);
          const distance = Math.abs(modelCenter - viewportCenter);
          const score = isVisible ? distance : 100000 + distance;

          if (score < bestScore) {
            bestScore = score;
            bestTarget = target;
          }
        });

        return bestTarget;
      }

      function applyStableState(nativeObserver) {
        const nextTarget = selectClosestVisibleModel();
        if (nextTarget === activeTarget) return;

        const entries = [];
        if (activeTarget) {
          entries.push({ target: activeTarget, isIntersecting: false });
        }
        if (nextTarget) {
          entries.push({ target: nextTarget, isIntersecting: true });
        }

        activeTarget = nextTarget;
        if (entries.length > 0) callback(entries, nativeObserver);
      }

      const nativeObserver = new NativeIntersectionObserver((entries, observer) => {
        const passthroughEntries = [];
        let inlineModelChanged = false;

        entries.forEach((entry) => {
          if (!isInlineModelTarget(entry.target)) {
            passthroughEntries.push(entry);
            return;
          }

          inlineModelChanged = true;
          states.set(entry.target, entry.isIntersecting);
        });

        if (passthroughEntries.length > 0) {
          callback(passthroughEntries, observer);
        }

        if (!inlineModelChanged) return;

        window.clearTimeout(settleTimer);
        settleTimer = window.setTimeout(() => applyStableState(observer), 180);
      }, options);

      const nativeObserve = nativeObserver.observe.bind(nativeObserver);
      const nativeUnobserve = nativeObserver.unobserve.bind(nativeObserver);
      const nativeDisconnect = nativeObserver.disconnect.bind(nativeObserver);

      nativeObserver.observe = (target) => {
        // 3D.html active le premier modèle juste après observe(). En le
        // considérant actif immédiatement, tout changement ultérieur libère
        // correctement ce premier lecteur avant d'en ouvrir un autre.
        if (isInlineModelTarget(target) && !activeTarget) {
          activeTarget = target;
        }
        return nativeObserve(target);
      };

      nativeObserver.unobserve = (target) => {
        states.delete(target);
        if (activeTarget === target) activeTarget = null;
        return nativeUnobserve(target);
      };

      nativeObserver.disconnect = () => {
        window.clearTimeout(settleTimer);
        states.clear();
        activeTarget = null;
        return nativeDisconnect();
      };

      return nativeObserver;
    }

    StableIntersectionObserver.prototype = NativeIntersectionObserver.prototype;
    Object.setPrototypeOf(StableIntersectionObserver, NativeIntersectionObserver);
    window.IntersectionObserver = StableIntersectionObserver;
  }

  stabilizeMuseumScroll();

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
    releaseRequested.delete(absoluteUrl);

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

        // Le modèle a quitté l'écran pendant son téléchargement : ne pas
        // conserver son Blob en mémoire, même si la requête termine après.
        if (releaseRequested.has(absoluteUrl)) {
          URL.revokeObjectURL(objectUrl);
          return source;
        }

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
    releaseRequested.add(absoluteUrl);

    const objectUrl = objectUrls.get(absoluteUrl);
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrls.delete(absoluteUrl);
  }

  window.ModelAssetCache = { resolve, invalidate, release };
})();
