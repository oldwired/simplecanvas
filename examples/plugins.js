// Copy this file beside index.html as plugins.js to try it. See PLUGINS.md.
// This example only reads the sketch and downloads a file; it uses no network services.
window.SimpleCanvasPlugins = {
  init(api) {
    if (api.version !== 1) throw new Error('This example requires plugin API version 1.');

    let changes = 0;
    let tabChanges = 0;
    api.on('change', () => { changes += 1; });
    api.on('tabchange', () => { tabChanges += 1; });

    api.ui.addMenuItem({
      label: 'Plugin: sketch info…',
      onClick() {
        const tab = api.getActiveTab();
        const sketch = api.getSketch();
        window.alert([
          `Active sketch: ${tab.name}`,
          `Objects: ${sketch.items.length}`,
          `Committed change events since startup: ${changes}`,
          `Tab change events since startup: ${tabChanges}`
        ].join('\n'));
      }
    });

    api.ui.addMenuItem({
      label: 'Plugin: download snapshot…',
      onClick() {
        const sketch = api.getSketch();
        const blob = new Blob([JSON.stringify(sketch, null, 2)], {
          type: 'application/json'
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'simplecanvas-plugin-snapshot.json';
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    });
  }
};
