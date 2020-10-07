const fs = require("fs");
const path = require("path");

const puppeteer = require("puppeteer");

function measureVisuallyComplete() {
  window.addEventListener("error", () => {
    console.log("err");
  });

  const windowItem = parent.window || window;

  windowItem.addEventListener("DOMContentLoaded", () => {
    windowItem.CPVisuallyComplete.onComplete((value) => {
      console.log("Visually complete in: ");
      console.log(value);
    });
  });
}

// function measureVisuallyComplete() {
// window.addEventListener("DOMContentLoaded", () => {
// const images = document.getElementsByTagName("img");

// for (const image of images) {
// image.addEventListener("load", () => {
// console.log(image.src);
// console.log(
// JSON.stringify(image.getBoundingClientRect(), undefined, 2)
// );
// });
// }

// const targetNode = document.body;

// const config = {
// attributes: true,
// childList: true,
// subtree: true,
// attributeOldValue: true,
// };

// const callback = function (mutationsList, observer) {
// for (let mutation of mutationsList) {
// if (mutation.type === "childList") {
// console.log(
// `A child node has been added (${mutation.addedNodes.length}) or removed (${mutation.removedNodes.length}).`
// );

// for (const node of mutation.addedNodes) {
// if (typeof node.getBoundingClientRect === "function") {
// const rect = node.getBoundingClientRect();
// console.log(JSON.stringify(rect, undefined, 2));
// }

// console.log(JSON.stringify(node.nodeName, undefined, 2));
// console.log(JSON.stringify(node.outerHTML, undefined, 2));
// }

// for (const node of mutation.removedNodes) {
// console.log(JSON.stringify(node.nodeName, undefined, 2));
// }

// console.log("--------------------");
// } else if (mutation.type === "attributes") {
// console.log(
// "The " +
// mutation.attributeName +
// ` attribute was modified. From "${mutation.oldValue}" to "${
// mutation.target[mutation.attributeName]
// }"`
// );
// }
// }
// };

// const observer = new MutationObserver(callback);

// observer.observe(targetNode, config);
// });
// }

function measurePerformance() {
  window.addEventListener("load", () => {
    setTimeout(() => {
      var p = performance.getEntries();
      for (var i = 0; i < p.length; i++) {
        console.log("PerformanceEntry[" + i + "]");
        console.log(JSON.stringify(p[i], null, 2));
      }
    }, 1000);
  });
}

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();

  await page.setCacheEnabled(false);
  await page.setViewport({ width: 1920, height: 1080 });

  page.on("console", (msg) => console.log(msg.text()));
  page.on("pageerror", (e) => console.log(e.message));

  let script = fs.readFileSync(path.join(__dirname, "visComplete.js"));
  await page.evaluateOnNewDocument(new Function(script));
  await page.evaluateOnNewDocument(measureVisuallyComplete);
  await page.evaluateOnNewDocument(measurePerformance);

  // await page.goto("https://angular2-hn.firebaseapp.com/news/1");
  // await page.goto(
  // "https://medium.com/walmartlabs/lazy-loading-images-intersectionobserver-8c5bff730920"
  // );
  // await page.goto("https://usa.visa.com");
  await page.goto("https://eu.katespade.com/en-nl/");
  // await page.goto("https://www.lifewire.com/");
  await page.screenshot({ path: path.join(__dirname, "before.png") });
  await page.waitFor(7000);
  await page.screenshot({ path: path.join(__dirname, "after.png") });
  await browser.close();
})();
