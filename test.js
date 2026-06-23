  <script>
    let currentSvgPath = "";
    let currentTitle = "";

    function openDrawingModal(svgPath, emoji, title) {
      currentSvgPath = svgPath;
      currentTitle = title;
      
      const modal = document.getElementById('drawing-modal');
      const panel = document.getElementById('modal-panel');
      const modalImg = document.getElementById('modal-img');
      const modalEmoji = document.getElementById('modal-emoji');
      const modalTitle = document.getElementById('modal-title');
      
      modalImg.src = svgPath;
      modalEmoji.innerText = emoji;
      modalTitle.innerText = title;
      
      modal.classList.remove('hidden');
      modal.classList.add('flex');
      
      // Trigger animation after layout render
      setTimeout(() => {
        panel.classList.remove('scale-95', 'opacity-0');
        panel.classList.add('scale-100', 'opacity-100');
      }, 20);
      
      document.body.style.overflow = 'hidden';
    }

    function closeDrawingModal() {
      const modal = document.getElementById('drawing-modal');
      const panel = document.getElementById('modal-panel');
      
      panel.classList.remove('scale-100', 'opacity-100');
      panel.classList.add('scale-95', 'opacity-0');
      
      setTimeout(() => {
        modal.classList.remove('flex');
        modal.classList.add('hidden');
        document.body.style.overflow = '';
      }, 200);
    }

    function triggerPrint() {
      if (currentSvgPath && currentTitle) {
        printDrawing(currentSvgPath, currentTitle);
      }
    }

    function printDrawing(svgPath, title) {
      // Create a hidden iframe for printing to avoid printing the entire webpage
      let iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = '0';
      document.body.appendChild(iframe);

      // Write printable layout to the iframe
      iframe.contentWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Coloriage - ${title}</title>
          <style>
            body {
              margin: 0;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              height: 100vh;
              font-family: system-ui, -apple-system, sans-serif;
              box-sizing: border-box;
              padding: 20px;
            }
            .container {
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              width: 100%;
              height: 100%;
              text-align: center;
            }
            img {
              width: 85%;
              height: 75vh;
              object-fit: contain;
            }
            h1 {
              margin-top: 15px;
              color: #1e293b;
              font-size: 20px;
              border-top: 2px dashed #cbd5e1;
              padding-top: 15px;
              width: 80%;
            }
            @media print {
              @page {
                size: portrait;
                margin: 1cm;
              }
              body {
                padding: 0;
              }
              h1 {
                font-size: 16px;
              }
            }
          </style>
        </head>
        <body>
          <div class="container">
            <img src="${window.location.origin + '/' + svgPath}" />
            <h1>🎨 Mon Dessin Devient 3D • Coloriage : ${title}</h1>
          </div>
          <script>
            window.onload = function() {
              setTimeout(function() {
                window.focus();
                window.print();
                setTimeout(function() {
                  window.frameElement.remove();
                }, 100);
              }, 400);
            };
          <\/script>
        </body>
        </html>
      `);
      iframe.contentWindow.document.close();
    }

    function initMenu() {
      const burger = document.getElementById('burger-btn');
      const drawer = document.getElementById('mobile-drawer');
      const panel = document.getElementById('drawer-panel');
      const backdrop = document.getElementById('drawer-backdrop');
      const closeBtn = document.getElementById('drawer-close');

      function openDrawer() {
        drawer.classList.remove('hidden');
        drawer.classList.add('flex');
        // Trigger slide from right to left
        requestAnimationFrame(() => {
          panel.classList.remove('translate-x-full');
          panel.classList.add('translate-x-0');
        });
        document.body.style.overflow = 'hidden';
      }

      function closeDrawer() {
        panel.classList.remove('translate-x-0');
        panel.classList.add('translate-x-full');
        
        setTimeout(() => {
          drawer.classList.remove('flex');
          drawer.classList.add('hidden');
          document.body.style.overflow = '';
        }, 280);
      }

      // Open
      burger.addEventListener('click', openDrawer);

      // Close actions
      closeBtn.addEventListener('click', closeDrawer);
      backdrop.addEventListener('click', closeDrawer);

      // Close drawer when clicking any link inside
      const links = drawer.querySelectorAll('.drawer-link');
      links.forEach(link => {
        link.addEventListener('click', () => {
          closeDrawer();
        });
      });

      // Close on ESC
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !drawer.classList.contains('hidden')) {
          closeDrawingModal();
          closeDrawer();
        }
      });

      console.log('%c[Menu] Fixed responsive menu with right-to-left drawer initialized', 'color:#64748b');
    }

    function init() {
      initMenu();
      console.log('%c[Atelier] Page simplifiée pour dessin papier prête', 'color:#64748b');
    }
    
    window.onload = init;
  </script>
