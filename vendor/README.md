# MQTT.js browser runtime

`mqtt-5.16.1.min.js` is the unmodified `dist/mqtt.min.js` browser bundle from
<https://registry.npmjs.org/mqtt/-/mqtt-5.16.1.tgz> (MQTT.js 5.16.1).

SHA-256: `75873d04a6400bbbac093b3602caf06f44ed92ee032925e1f4f21c03eba05a4e`.

The upstream MIT license is in `mqtt-LICENSE.md`; dependency notices are retained
inside the browser bundle. `tools/update-mqtt-bundle.cjs` embeds the checked-in
source into `index.html`. HTML exports include the same function and do not load
a CDN or another local file. Regenerate the demo readers after updating it.

Upstream project: <https://github.com/mqttjs/MQTT.js>.
