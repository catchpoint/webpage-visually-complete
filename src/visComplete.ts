/// <reference path="../scripts/v3_3_1/main.js" />
interface VisuallyComplete {
    getValue: () => number;
    onComplete: (callback: (val: number) => void) => void;
    reset: () => void;
}

interface Window {
    CPVisuallyComplete: VisuallyComplete;
}

interface Rectangle {
    top: number;
    right: number;
    bottom: number;
    left: number;
    isIframe: boolean;
    url: string;
    time: number;
}

/**
 * Visually completed is calculated using Mutation observer, when elements added to the page we are tracking the time stamp.
 * After page load VisComplete listen to mutations for 5sec and will disconnect mutation observer.
 * If the difference between previous mutation and the current mutation is greater than 500ms mutation observer will be disconnected.
 * VisComplete also listen to all the resources being loaded on the page (till 2s after page load) and take the end time of the last resource.
 * Max value of the Mutation and the last resource to get the response will be considered as Visually complete
 * VisComplete listen to scroll and click events to avoid miscalculation of VCT and will stop calculating if one of the events fired.
 * */

const windowItem: Window = parent.window || window;
windowItem.CPVisuallyComplete = (function () {
    class VisComplete implements VisuallyComplete {
        private targetWindow: Window = windowItem;
        private mutationObserver = undefined;
        private start = 0;
        private waitMs = 2000; //The time to wait after onload, before we start running our vis complete logic
        private maxResourceTiming = 0;
        private callback: (val: number) => void;
        private mutationObserverVal = 0;
        private readonly scroll = "scroll";
        private readonly click = "click";
        private softNav: boolean;
        private timeout: number;
        private readonly maxDiffBetweenMutation: number = 1000;
        private readonly sinceLastXHR: number = 500;
        private readonly disconnectObserverTimeout = 5000;
        private hasPerformance =
            typeof this.targetWindow.performance === "object" &&
            typeof this.targetWindow.performance.getEntriesByType === "function";

        constructor() {
            this.initMutationObserver();
            this.captureSoftNavigations();
            this.init();
        }

        private removeListeners = () => {
            document.removeEventListener(this.scroll, this.clear);
            document.removeEventListener(this.click, this.clear);
        };

        private addListeners = () => {
            document.addEventListener(this.scroll, this.clear);
            document.addEventListener(this.click, this.clear);
        };

        private imageListener = (event) => {
            const requests = this.targetWindow.performance.getEntriesByType(
                "resource"
            );
            let request = undefined;
            for (let i = 0; i < requests.length; i++) {
                if (requests[i].name === event.target.currentSrc) {
                    request = requests[i];
                    break;
                }
            }

            if (request) {
                this.maxResourceTiming = Math.max(
                    this.maxResourceTiming,
                    Math.round((request as PerformanceResourceTiming).responseEnd)
                );
            }

            event.currentTarget.removeEventListener("load", this.imageListener);
        };

        private videoListener = (event) => {
            this.maxResourceTiming = Math.max(
                this.maxResourceTiming,
                Math.round(this.getPerformanceTime())
            );

            event.currentTarget.removeEventListener("canplay", this.imageListener);
        };

        private addListenersForDynamicContent = (element: HTMLDocument) => {
            const images = element.querySelectorAll("img");
            for (let i = 0; i < images.length; i += 1) {
                const image = images[i];
                if (this.isVisible(image)) {
                    image.addEventListener("load", this.imageListener);
                }
            }

            const videos = element.querySelectorAll("video");
            for (let i = 0; i < videos.length; i += 1) {
                const video = videos[i];
                if (this.isVisible(video)) {
                    video.addEventListener("canplay", this.videoListener);
                }
            }
        };

        private init() {
            const document = this.targetWindow.document;
            if (document.readyState === "complete") {
                this.onLoad();
            } else {
                this.targetWindow.addEventListener("load", this.onLoad);
            }

            if (document.readyState === "interactive") {
                this.addListenersForDynamicContent(document);
            } else {
                this.targetWindow.addEventListener("DOMContentLoaded", () => {
                    this.addListenersForDynamicContent(document);
                });
            }

            this.removeListeners();
            this.addListeners();
        }

        private clear = () => {
            clearTimeout(this.timeout);
            this.removeListeners();
            this.trigger();
        };

        private onLoad = () => {
            this.timeout = window.setTimeout(() => {
                this.removeListeners();
                this.calculate();
            }, this.waitMs);
        };

        private getBackgroundImagesTiming = () => {
            const extractImageUrl = (backgroundImage) => {
                if (backgroundImage && backgroundImage.startsWith("url")) {
                    const match = backgroundImage.match(/url\(["']?([^"']*)["']?\)/);
                    const url = match && ((match.length > 1) && match[1]);
                    if (url && !url.startsWith("data")) {
                        return url;
                    }
                }

                return null;
            };

            const imagesToCheck = [];

            for (let i = 0; i < document.styleSheets.length; i += 1) {
                const styleSheet = document.styleSheets[i] as CSSStyleSheet;
                try {
                    for (let j = 0; j < styleSheet.cssRules.length; j += 1) {
                        const cssRule = styleSheet.cssRules[j] as CSSStyleRule;
                        const selector = cssRule.selectorText;
                        const style = cssRule.style;

                        if (style) {
                            for (let k = 0; k < style.length; k += 1) {
                                const propertyName = style[k];
                                if (propertyName === "background-image") {
                                    const propertyValue = style[propertyName];
                                    const url = extractImageUrl(propertyValue);

                                    if (url) {
                                        const element = this.targetWindow.document.querySelector(
                                            selector
                                        );

                                        if (this.isVisible(element)) {
                                            imagesToCheck.push(url);
                                        }
                                    }
                                }
                            }
                        }
                    }
                } catch (e) { }
            }

            const elements = this.targetWindow.document.querySelectorAll(
                '[style*="background"]'
            );

            for (let i = 0; i < elements.length; i++) {
                if (this.isVisible(elements[i])) {
                    const styles = this.targetWindow.getComputedStyle(elements[i]);
                    const backgroundImage = styles.getPropertyValue("background-image");
                    const url = extractImageUrl(backgroundImage);

                    if (url) {
                        imagesToCheck.push(url);
                    }
                }
            }

            for (const url of imagesToCheck) {
                const requests = this.targetWindow.performance.getEntriesByType(
                    "resource"
                );
                let request = undefined;
                for (let i = 0; i < requests.length; i++) {
                    if (requests[i].name === new URL(url, this.targetWindow.location.href).href) {
                        request = requests[i];
                        break;
                    }
                }

                if (request) {
                    this.maxResourceTiming = Math.max(
                        this.maxResourceTiming,
                        Math.round((request as PerformanceResourceTiming).responseEnd)
                    );
                }
            }
        };

        private calculate = () => {
            if (!this.targetWindow.performance) {
                this.trigger();
                return;
            }

            this.getBackgroundImagesTiming();
            // this.calcResourceBasedVisuallyCompleteTime();
            this.trigger();
        };

        private getPerformanceTime = () => {
            return this.targetWindow["performance"].now();
        };

        private resetValueOnSoftNav = () => {
            this.mutationObserverVal = 0;
            this.maxResourceTiming = 0;
            this.softNav = false;
        };

        private isVisible = (node) => {
            const rect =
                typeof node.getBoundingClientRect === "function" &&
                node.getBoundingClientRect();

            // if the added element is Visible in the view port
            const isNodeInViewport =
                rect &&
                rect.width * rect.height >= 8 &&
                rect.right >= 0 &&
                rect.bottom >= 0 &&
                rect.left <= this.targetWindow.innerWidth &&
                rect.top <= this.targetWindow.innerHeight &&
                !node.hidden &&
                node.type !== "hidden";

            if (isNodeInViewport) {
                const style = window.getComputedStyle(node);

                return (
                    style.display !== "none" &&
                    style.visibility !== "hidden" &&
                    style.visibility !== "collapse" &&
                    +style.opacity > 0
                );
            }

            return false;
        };

        private mutationCallback = (mutationsList: MutationRecord[]) => {
            mutationsList.forEach((mutation) => {
                if (mutation.type === "childList" && mutation.addedNodes.length > 0) {
                    const addedNode = mutation.addedNodes[0] as any;

                    if (this.isVisible(addedNode)) {
                        // console.log(addedNode.nodeName);

                        if (addedNode.nodeName.toLowerCase() === "img") {
                            addedNode.addEventListener("load", this.imageListener);
                        }

                        if (addedNode.nodeName.toLowerCase() === "video") {
                            addedNode.addEventListener("canplay", this.videoListener);
                        }

                        const perfTime = this.getPerformanceTime();
                        if (this.softNav) {
                            this.resetValueOnSoftNav();
                        }
                        // console.log(perfTime);

                        const requests = this.targetWindow.performance.getEntriesByType(
                            "resource"
                        );

                        let lastXHR: PerformanceResourceTiming = undefined;
                        for (let i = 0; i < requests.length; i++) {
                            if ((requests[i] as PerformanceResourceTiming).initiatorType === "xmlhttprequest") {
                                lastXHR = requests[i] as PerformanceResourceTiming;
                                break;
                            }
                        }

                        if (
                            this.mutationObserverVal === 0 ||
                            (lastXHR && perfTime - lastXHR.responseEnd < this.sinceLastXHR) ||
                            perfTime - this.mutationObserverVal <= this.maxDiffBetweenMutation
                        ) {
                            this.mutationObserverVal = Math.round(perfTime);
                        }
                    }
                } else if (mutation.type === "attributes") {
                    if (
                        mutation.target.nodeName.toLowerCase() === "img" &&
                        mutation.attributeName === "src"
                    ) {
                        if (this.isVisible(mutation.target)) {
                            mutation.target.addEventListener(
                                "load",
                                this.imageListener
                            );
                        }
                    }
                }
            });
        };

        private initMutationObserver = () => {
            const browserMutationObserver =
                this.targetWindow["MutationObserver"] ||
                this.targetWindow["WebKitMutationObserver"] ||
                this.targetWindow["MozMutationObserver"];
            if (browserMutationObserver && this.targetWindow["performance"]) {
                this.mutationObserver = new browserMutationObserver(
                    this.mutationCallback
                );
                this.observe();
            }
        };

        private trigger = () => {
            if (this.callback) {
                const visCompTime = this.getValue();
                this.callback(visCompTime);
            }
        };

        private observe = () => {
            this.mutationObserver.observe(this.targetWindow.document, {
                childList: true,
                attributes: true,
                characterData: true,
                subtree: true,
            });
            setTimeout(() => {
                this.mutationObserver.disconnect();
            }, this.disconnectObserverTimeout);
        };

        getValue = (): number => {
            if (this.maxResourceTiming || this.mutationObserverVal) {
                let visCompTime = 0;
                if (this.maxResourceTiming && this.mutationObserverVal) {
                    visCompTime = Math.max(
                        this.maxResourceTiming,
                        this.mutationObserverVal,
                        Math.round(this.getFirstPaintTime())
                    );
                } else if (this.maxResourceTiming) {
                    visCompTime = this.maxResourceTiming;
                } else if (this.mutationObserverVal) {
                    visCompTime = this.mutationObserverVal;
                }
                return visCompTime - this.start;
            }

            return undefined;
        };

        onComplete = (callback: (val: number) => void) => {
            this.callback = callback;
        };

        reset = () => {
            this.softNav = true;
            if (this.targetWindow["performance"]) {
                this.start = this.getPerformanceTime();
                this.mutationObserver.disconnect();
                this.observe();
                this.onLoad();
            }
        };

        private getMaxResourceTime() {
            let maxTime = 0;
            const initiatorTypes: string[] = [
                "img",
                "iframe",
                // "css",
                "script",
                "subdocument",
            ];
            const requests = this.targetWindow.performance.getEntriesByType(
                "resource"
            ) as PerformanceResourceTiming[];
            for (const request of requests) {
                let requestEnd = request.responseEnd;
                if (
                    initiatorTypes.indexOf(request.initiatorType) > -1 &&
                    requestEnd > this.start
                ) {
                    if (!maxTime || requestEnd > maxTime) {
                        maxTime = Math.round(requestEnd);
                    }
                }
            }
            return maxTime;
        }

        private addEvent(type: string, target: any, func: (any) => any) {
            if (this.targetWindow.attachEvent) {
                target.attachEvent("on" + type, func);
            } else {
                target.addEventListener(type, func, false);
            }
        }

        private captureSoftNavigations = () => {
            if (
                !this.targetWindow["HashChangeEvent"] ||
                this.targetWindow["RProfiler"]
            ) {
                return;
            }

            this.addEvent("hashchange", this.targetWindow, this.reset);

            const history = this.targetWindow.history;
            if (!history) {
                return;
            }

            const functionStr = "function";
            if (typeof history.go === functionStr) {
                const origGo = history.go;
                history.go = (delta?: number) => {
                    this.reset();
                    origGo.call(history, delta);
                };
            }

            if (typeof history.back === functionStr) {
                const origBack = history.back;
                history.back = () => {
                    this.reset();
                    origBack.call(history);
                };
            }

            if (typeof history.forward === functionStr) {
                const origForward = history.forward;
                history.forward = () => {
                    this.reset();
                    origForward.call(history);
                };
            }

            if (typeof history.pushState === functionStr) {
                const origPush = history.pushState;
                history.pushState = (data: any, title: string, url?: string) => {
                    this.reset();
                    origPush.call(history, data, title, url);
                };
            }

            if (typeof history.replaceState === functionStr) {
                const origReplace = history.replaceState;
                history.replaceState = (data: any, title: string, url?: string) => {
                    this.reset();
                    origReplace.call(history, data, title, url);
                };
            }
        };

        private calcResourceBasedVisuallyCompleteTime = () => {
            if (this.hasPerformance) {
                this.maxResourceTiming = this.getMaxResourceTime();
            }
        };

        private getResourceTimings(): PerformanceResourceTiming[] {
            try {
                const timings = this.targetWindow.performance.getEntriesByType(
                    "resource"
                );
                return timings as PerformanceResourceTiming[];
            } catch { }
        }

        private getFirstPaintTime(): number {
            let paintTime = 0;
            try {
                const paintTimings = this.targetWindow.performance.getEntriesByType("paint");
                if (paintTimings && paintTimings.length > 0) {
                    const firstPaint = paintTimings.filter(
                        (x) => x.name === "first-paint"
                    );
                    if (firstPaint && firstPaint.length > 0 && firstPaint[0].startTime) {
                        paintTime = firstPaint[0].startTime;
                    }
                    const firstContentfulPaint = paintTimings.filter(
                        (x) => x.name === "first-contentful-paint"
                    );
                    if (
                        firstContentfulPaint &&
                        firstContentfulPaint.length > 0 &&
                        firstContentfulPaint[0].startTime
                    ) {
                        paintTime = firstContentfulPaint[0].startTime;
                    }
                }
            } catch { }
            return paintTime;
        }
    }

    const visComplete = new VisComplete();
    return {
        getValue: visComplete.getValue,
        onComplete: visComplete.onComplete,
        reset: visComplete.reset,
    };
})();
