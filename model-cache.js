(function () {
  const CACHE_NAME = 'dessin-3d-modeles-v1';
  const objectUrls = new Map();
  const pendingUrls = new Map();

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
            response = await fetch(absoluteUrl);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            try {
              await cache.put(absoluteUrl, response.clone());
            } catch (cacheError) {
              // Un quota trop faible ne doit pas provoquer un second
              // téléchargement : on garde tout de même la réponse en mémoire.
              console.warn(`[3D cache] Stockage persistant indisponible pour ${source}`, cacheError);
            }
          }
        } else {
          response = await fetch(absoluteUrl);
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

  window.ModelAssetCache = { resolve };
})();
