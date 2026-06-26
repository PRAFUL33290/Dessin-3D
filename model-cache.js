(function () {
  const CACHE_NAME = 'dessin-3d-modeles-v1';
  const objectUrls = new Map();
  const pendingUrls = new Map();

  // Sur la page Musée, détruire puis recréer un <model-viewer> à chaque
  // micro-scroll crée de nouveaux contextes WebGL. Safari/iOS peut alors
  // finir par afficher une page blanche. Une carte déjà rencontrée reste
  // donc chargée jusqu'à ce que l'utilisateur quitte la page.
  function stabilizeMuseumScroll() {
    const isMuseumPage = /(?:^|\/)3d\.html$/i.test(window.location.pathname);
    if (!isMuseumPage || !('IntersectionObserver' in window)) return;

    const NativeIntersectionObserver = window.IntersectionObserver;
    if (NativeIntersectionObserver.__dessin3dMuseumStable) return;
    NativeIntersectionObserver.__dessin3dMuseumStable = true;

    function StableIntersectionObserver(callback, options) {
      const seenInlineModels = new WeakSet();

      return new NativeIntersectionObserver((entries, observer) => {
        const stableEntries = entries.filter((entry) => {
          const target = entry.target;
          const isInlineModel = target && target.classList && target.classList.contains('inline-model');

          if (!isInlineModel) return true;

          if (entry.isIntersecting) {
            seenInlineModels.add(target);
            return true;
          }

          // Le script de 3D.html libère le modèle dès qu'il sort de l'écran.
          // On ignore uniquement cette sortie après son premier affichage afin
          // d'éviter les rechargements WebGL en boucle pendant le scroll.
          return !seenInlineModels.has(target);
        });

        if (stableEntries.length > 0) callback(stableEntries, observer);
      }, options);
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
