/*
 * Copyright (c) 2012 - present Adobe Systems Incorporated. All rights reserved.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"),
 * to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 * DEALINGS IN THE SOFTWARE.
 *
 */

/*jslint forin: true */
/*global Node, MessageEvent */
/*theseus instrument: false */

/**
 * RemoteFunctions define the functions to be executed in the browser. This
 * modules should define a single function that returns an object of all
 * exported functions.
 */
function RemoteFunctions(config, remoteWSPort) {
    "use strict";

    var experimental;
    if (!config) {
        experimental = false;
    } else {
        experimental = config.experimental;
    }
    var lastKeepAliveTime = Date.now();
    var req, timeout;
    var animateHighlight = function (time) {
        if (req) {
            window.cancelAnimationFrame(req);
            window.clearTimeout(timeout);
        }
        req = window.requestAnimationFrame(redrawHighlights);

        timeout = setTimeout(function () {
            window.cancelAnimationFrame(req);
            req = null;
        }, time * 1000);
    };

    /**
     * @type {DOMEditHandler}
     */
    var _editHandler;
    
    
    var lastHiglightedElement;

    var HIGHLIGHT_CLASSNAME = "__brackets-ld-highlight",
        KEEP_ALIVE_TIMEOUT  = 3000;   // Keep alive timeout value, in milliseconds

    // determine whether an event should be processed for Live Development
    function _validEvent(event) {
        if (window.navigator.platform.substr(0, 3) === "Mac") {
            // Mac
            return event.metaKey;
        } else {
            // Windows
            return event.ctrlKey;
        }
    }

    // determine the color for a type
    function _typeColor(type, highlight) {
        switch (type) {
        case "html":
            return highlight ? "#eec" : "#ffe";
        case "css":
            return highlight ? "#cee" : "#eff";
        case "js":
            return highlight ? "#ccf" : "#eef";
        default:
            return highlight ? "#ddd" : "#eee";
        }
    }

    // compute the screen offset of an element
    function _screenOffset(element) {
        var elemBounds = element.getBoundingClientRect(),
            body = window.document.body,
            offsetTop,
            offsetLeft;

        if (window.getComputedStyle(body).position === "static") {
            offsetLeft = elemBounds.left + window.pageXOffset;
            offsetTop = elemBounds.top + window.pageYOffset;
        } else {
            var bodyBounds = body.getBoundingClientRect();
            offsetLeft = elemBounds.left - bodyBounds.left;
            offsetTop = elemBounds.top - bodyBounds.top;
        }
        return { left: offsetLeft, top: offsetTop };
    }

    // set an event on a element
    function _trigger(element, name, value, autoRemove) {
        var key = "data-ld-" + name;
        if (value !== undefined && value !== null) {
            element.setAttribute(key, value);
            if (autoRemove) {
                window.setTimeout(element.removeAttribute.bind(element, key));
            }
        } else {
            element.removeAttribute(key);
        }
    }
    
    // Checks if the element is in Viewport in the client browser
    function isInViewport(element) {
        var rect = element.getBoundingClientRect();
        var html = window.document.documentElement;
        return (
            rect.top >= 0 &&
            rect.left >= 0 &&
            rect.bottom <= (window.innerHeight || html.clientHeight) &&
            rect.right <= (window.innerWidth || html.clientWidth)
        );
    }
    
    // returns the distance from the top of the closest relatively positioned parent element
    function getDocumentOffsetTop(element) {
        return element.offsetTop + (element.offsetParent ? getDocumentOffsetTop(element.offsetParent) : 0);
    }

    // construct the info menu
    function Menu(element) {
        this.element = element;
        _trigger(this.element, "showgoto", 1, true);
        window.setTimeout(window.remoteShowGoto);
        this.remove = this.remove.bind(this);
    }

    Menu.prototype = {
        onClick: function (url, event) {
            event.preventDefault();
            _trigger(this.element, "goto", url, true);
            this.remove();
        },

        createBody: function () {
            if (this.body) {
                return;
            }

            // compute the position on screen
            var offset = _screenOffset(this.element),
                x = offset.left,
                y = offset.top + this.element.offsetHeight;

            // create the container
            this.body = window.document.createElement("div");
            this.body.style.setProperty("z-index", 2147483647);
            this.body.style.setProperty("position", "absolute");
            this.body.style.setProperty("left", x + "px");
            this.body.style.setProperty("top", y + "px");
            this.body.style.setProperty("font-size", "11pt");

            // draw the background
            this.body.style.setProperty("background", "#fff");
            this.body.style.setProperty("border", "1px solid #888");
            this.body.style.setProperty("-webkit-box-shadow", "2px 2px 6px 0px #ccc");
            this.body.style.setProperty("border-radius", "6px");
            this.body.style.setProperty("padding", "6px");
        },

        addItem: function (target) {
            var item = window.document.createElement("div");
            item.style.setProperty("padding", "2px 6px");
            if (this.body.childNodes.length > 0) {
                item.style.setProperty("border-top", "1px solid #ccc");
            }
            item.style.setProperty("cursor", "pointer");
            item.style.setProperty("background", _typeColor(target.type));
            item.innerHTML = target.name;
            item.addEventListener("click", this.onClick.bind(this, target.url));

            if (target.file) {
                var file = window.document.createElement("i");
                file.style.setProperty("float", "right");
                file.style.setProperty("margin-left", "12px");
                file.innerHTML = " " + target.file;
                item.appendChild(file);
            }
            this.body.appendChild(item);
        },

        show: function () {
            if (!this.body) {
                this.body = this.createBody();
            }
            if (!this.body.parentNode) {
                window.document.body.appendChild(this.body);
            }
            window.document.addEventListener("click", this.remove);
        },

        remove: function () {
            if (this.body && this.body.parentNode) {
                window.document.body.removeChild(this.body);
            }
            window.document.removeEventListener("click", this.remove);
        }

    };

    function Editor(element) {
        this.onBlur = this.onBlur.bind(this);
        this.onKeyPress = this.onKeyPress.bind(this);

        this.element = element;
        this.element.setAttribute("contenteditable", "true");
        this.element.focus();
        this.element.addEventListener("blur", this.onBlur);
        this.element.addEventListener("keypress", this.onKeyPress);

        this.revertText = this.element.innerHTML;

        _trigger(this.element, "edit", 1);
    }

    Editor.prototype = {
        onBlur: function (event) {
            this.element.removeAttribute("contenteditable");
            this.element.removeEventListener("blur", this.onBlur);
            this.element.removeEventListener("keypress", this.onKeyPress);
            _trigger(this.element, "edit", 0, true);
        },

        onKeyPress: function (event) {
            switch (event.which) {
            case 13: // return
                this.element.blur();
                break;
            case 27: // esc
                this.element.innerHTML = this.revertText;
                this.element.blur();
                break;
            }
        }
    };
    
    function _processDecodedURL(path, files) {
        var elements = path.split("/");
        var folder;
        
        while (elements.length > 1) {
            elements.pop();
            folder =  elements.join("/").split("%20").join(' ');
            if (files.indexOf(folder) === -1) {
                files.push(folder + '/');
            }
        }
            
        return path.split("%20").join(' ');
    }
    
    function _isResourceFromDisk(path) {
        return path.indexOf(window.location.origin) === 0;
    }
    
    function _collateResources() {
        var files = [], item;
        
        var sourceFile = window.location.href.replace(window.location.origin, "").split("%20").join(' ');
        
        files.push(_processDecodedURL(window.location.href.replace(window.location.origin, ""), files));
        
        for (item in window.document.styleSheets) {
            if (window.document.styleSheets[item].href && _isResourceFromDisk(window.document.styleSheets[item].href)) {
                files.push(_processDecodedURL(window.document.styleSheets[item].href.replace(window.location.origin, ""), files));
            }
        }
        
        for (item in window.document.scripts) {
            if (window.document.scripts[item].src && _isResourceFromDisk(window.document.scripts[item].src)) {
                files.push(_processDecodedURL(window.document.scripts[item].src.replace(window.location.origin, ""), files));
            }
        }
        
        for (item in window.document.images) {
            if (window.document.images[item].src && _isResourceFromDisk(window.document.images[item].src)) {
                files.push(_processDecodedURL(window.document.images[item].src.replace(window.location.origin, ""), files));
            }
        }
        
        var msg = JSON.stringify({relatedFiles: JSON.stringify(files), source: sourceFile});

        _sendDataOverSocket(JSON.stringify({
            type: "livedata",
            message: msg
        }));
    }

    function Highlight(color, trigger) {
        this.color = color;
        this.trigger = !!trigger;
        this.elements = [];
        this.selector = "";
    }

    Highlight.prototype = {
        _elementExists: function (element) {
            var i;
            for (i in this.elements) {
                if (this.elements[i] === element) {
                    return true;
                }
            }
            return false;
        },
        _makeHighlightDiv: function (element, doAnimation) {
            var elementBounds = element.getBoundingClientRect(),
                highlight = window.document.createElement("div"),
                elementStyling = window.getComputedStyle(element),
                transitionDuration = parseFloat(elementStyling.getPropertyValue('transition-duration')),
                animationDuration = parseFloat(elementStyling.getPropertyValue('animation-duration'));
            
            if (transitionDuration) {
                animateHighlight(transitionDuration);
            }

            if (animationDuration) {
                animateHighlight(animationDuration);
            }

            // Don't highlight elements with 0 width & height
            if (elementBounds.width === 0 && elementBounds.height === 0) {
                return;
            }
            
            var realElBorder = {
                right: elementStyling.getPropertyValue('border-right-width'),
                left: elementStyling.getPropertyValue('border-left-width'),
                top: elementStyling.getPropertyValue('border-top-width'),
                bottom: elementStyling.getPropertyValue('border-bottom-width')
            };
            
            var borderBox = elementStyling.boxSizing === 'border-box';
            
            var innerWidth = parseFloat(elementStyling.width),
                innerHeight = parseFloat(elementStyling.height),
                outerHeight = innerHeight,
                outerWidth = innerWidth;
                
            if (!borderBox) {
                innerWidth += parseFloat(elementStyling.paddingLeft) + parseFloat(elementStyling.paddingRight);
                innerHeight += parseFloat(elementStyling.paddingTop) + parseFloat(elementStyling.paddingBottom);
                outerWidth = innerWidth + parseFloat(realElBorder.right) + parseFloat(realElBorder.left);
                outerHeight = innerHeight + parseFloat(realElBorder.bottom) + parseFloat(realElBorder.top);
            }

          
            var visualisations = {
                horizontal: "left, right",
                vertical: "top, bottom"
            };
          
            var drawPaddingRect = function(side) {
                var elStyling = {};

                if (visualisations.horizontal.indexOf(side) >= 0) {
                    elStyling.width =  elementStyling.getPropertyValue('padding-' + side);
                    elStyling.height = innerHeight + "px";
                    elStyling.top = 0;

                    if (borderBox) {
                        elStyling.height = innerHeight - parseFloat(realElBorder.top) - parseFloat(realElBorder.bottom) + "px";
                    }

                } else {
                    elStyling.height = elementStyling.getPropertyValue('padding-' + side);  
                    elStyling.width = innerWidth + "px";
                    elStyling.left = 0;

                    if (borderBox) {
                        elStyling.width = innerWidth - parseFloat(realElBorder.left) - parseFloat(realElBorder.right) + "px";
                    }
                }

                elStyling[side] = 0;
                elStyling.position = 'absolute';

                return elStyling;
            };
          
          var drawMarginRect = function(side) {
              var elStyling = {};
            
              var margin = [];
              margin.right = parseFloat(elementStyling.getPropertyValue('margin-right'));
              margin.top = parseFloat(elementStyling.getPropertyValue('margin-top'));
              margin.bottom = parseFloat(elementStyling.getPropertyValue('margin-bottom'));
              margin.left = parseFloat(elementStyling.getPropertyValue('margin-left'));
          
              if(visualisations.horizontal.indexOf(side) >= 0) {
                  elStyling.width = elementStyling.getPropertyValue('margin-' + side);
                  elStyling.height = outerHeight + margin['top'] + margin['bottom'] + "px";
                  elStyling.top = "-" + (margin['top'] + parseFloat(realElBorder.top))  + "px";
              } else {
                  elStyling.height = elementStyling.getPropertyValue('margin-' + side);
                  elStyling.width = outerWidth + "px";
                  elStyling.left = "-" + realElBorder.left;
              }

              elStyling[side] = "-" + (margin[side] + parseFloat(realElBorder[side])) + "px";
              elStyling.position = 'absolute';

              return elStyling;
          };

            var setVisibility = function (el) {
                if (
                    !config.remoteHighlight.showPaddingMargin || 
                    parseInt(el.height, 10) <= 0 || 
                    parseInt(el.width, 10) <= 0 
                ) {
                    el.display = 'none';
                } else {
                    el.display = 'block';
                }
            };
            
            var mainBoxStyles = config.remoteHighlight.stylesToSet;
            
            var paddingVisualisations = [
                drawPaddingRect('top'),
                drawPaddingRect('right'),
                drawPaddingRect('bottom'),
                drawPaddingRect('left')  
            ];
                
            var marginVisualisations = [
                drawMarginRect('top'),
                drawMarginRect('right'),
                drawMarginRect('bottom'),
                drawMarginRect('left')  
            ];
            
            var setupVisualisations = function (arr, config) {
                var i;
                for (i = 0; i < arr.length; i++) {
                    setVisibility(arr[i]);
                    
                    // Applies to every visualisationElement (padding or margin div)
                    arr[i]["transform"] = "none";
                    var el = window.document.createElement("div"),
                        styles = Object.assign(
                            {},
                            config,
                            arr[i]
                        );

                    _setStyleValues(styles, el.style);

                    highlight.appendChild(el);
                }
            };
            
            setupVisualisations(
                marginVisualisations,
                config.remoteHighlight.marginStyling
            );
            setupVisualisations(
                paddingVisualisations,
                config.remoteHighlight.paddingStyling
            );
            
            highlight.className = HIGHLIGHT_CLASSNAME;

            var offset = _screenOffset(element);

            var el = element,
            offsetLeft = 0,
            offsetTop  = 0;

            // Probably the easiest way to get elements position without including transform
            do {
               offsetLeft += el.offsetLeft;
               offsetTop  += el.offsetTop;
               el = el.offsetParent;
            } while(el);

            var stylesToSet = {
                "left": offsetLeft + "px",
                "top": offsetTop + "px",
                "width": innerWidth + "px",
                "height": innerHeight + "px",
                "z-index": 2000000,
                "margin": 0,
                "padding": 0,
                "position": "absolute",
                "pointer-events": "none",
                "box-shadow": "0 0 1px #fff",
                "box-sizing": elementStyling.getPropertyValue('box-sizing'),
                "border-right": elementStyling.getPropertyValue('border-right'),
                "border-left": elementStyling.getPropertyValue('border-left'),
                "border-top": elementStyling.getPropertyValue('border-top'),
                "border-bottom": elementStyling.getPropertyValue('border-bottom'),
                "transform": elementStyling.getPropertyValue('transform'),
                "transform-origin": elementStyling.getPropertyValue('transform-origin'),
                "border-color": config.remoteHighlight.borderColor
            };
            
            var mergedStyles = Object.assign({}, stylesToSet,  config.remoteHighlight.stylesToSet);

            var animateStartValues = config.remoteHighlight.animateStartValue;

            var animateEndValues = config.remoteHighlight.animateEndValue;

            var transitionValues = {
                "transition-property": "opacity, background-color, transform",
                "transition-duration": "300ms, 2.3s"
            };

            function _setStyleValues(styleValues, obj) {
                var prop;

                for (prop in styleValues) {
                    obj.setProperty(prop, styleValues[prop]);
                }
            }

            _setStyleValues(mergedStyles, highlight.style);
            _setStyleValues(
                doAnimation ? animateStartValues : animateEndValues,
                highlight.style
            );


            if (doAnimation) {
                _setStyleValues(transitionValues, highlight.style);

                window.setTimeout(function () {
                    _setStyleValues(animateEndValues, highlight.style);
                }, 20);
            }

            window.document.body.appendChild(highlight);
            
            if (_ws && element && element.hasAttribute('data-brackets-id')) {
                setTimeout(function () {
                    _sendLiveInspectionData(element);
                }, 100);
            }
        },

        add: function (element, doAnimation) {
            if (this._elementExists(element) || element === window.document) {
                return;
            }
            if (this.trigger) {
                _trigger(element, "highlight", 1);
            }
            
            if ((!window.event || window.event instanceof MessageEvent) && !isInViewport(element)) {
                var top = getDocumentOffsetTop(element);
                if (top) {
                    top -= (window.innerHeight / 2);
                    window.scrollTo(0, top);
                }
            }
            this.elements.push(element);

            this._makeHighlightDiv(element, doAnimation);
        },

        clear: function () {
            var i, highlights = window.document.querySelectorAll("." + HIGHLIGHT_CLASSNAME),
                body = window.document.body;

            for (i = 0; i < highlights.length; i++) {
                body.removeChild(highlights[i]);
            }

            if (this.trigger) {
                for (i = 0; i < this.elements.length; i++) {
                    _trigger(this.elements[i], "highlight", 0);
                }
            }

            this.elements = [];
        },

        redraw: function () {
            var i, highlighted;

            // When redrawing a selector-based highlight, run a new selector
            // query to ensure we have the latest set of elements to highlight.
            if (this.selector) {
                highlighted = window.document.querySelectorAll(this.selector);
            } else {
                highlighted = this.elements.slice(0);
            }

            this.clear();
            for (i = 0; i < highlighted.length; i++) {
                this.add(highlighted[i], false);
            }
        }
    };

    var _currentEditor;
    function _toggleEditor(element) {
        _currentEditor = new Editor(element);
    }

    var _currentMenu;
    function _toggleMenu(element) {
        if (_currentMenu) {
            _currentMenu.remove();
        }
        _currentMenu = new Menu(element);
    }

    var _localHighlight;
    var _remoteHighlight;
    var _setup = false;


    /** Event Handlers ***********************************************************/

    function onMouseOver(event) {
        if (_validEvent(event)) {
            _localHighlight.add(event.target, true);
        }
    }

    function onMouseOut(event) {
        if (_validEvent(event)) {
            _localHighlight.clear();
        }
    }

    function onMouseMove(event) {
        onMouseOver(event);
        window.document.removeEventListener("mousemove", onMouseMove);
    }

    function onClick(event) {
        if (_validEvent(event)) {
            event.preventDefault();
            event.stopPropagation();
            if (event.altKey) {
                _toggleEditor(event.target);
            } else {
                _toggleMenu(event.target);
            }
        }
    }

    function onKeyUp(event) {
        if (_setup && !_validEvent(event)) {
            window.document.removeEventListener("keyup", onKeyUp);
            window.document.removeEventListener("mouseover", onMouseOver);
            window.document.removeEventListener("mouseout", onMouseOut);
            window.document.removeEventListener("mousemove", onMouseMove);
            window.document.removeEventListener("click", onClick);
            _localHighlight.clear();
            _localHighlight = undefined;
            _setup = false;
        }
    }

    function onKeyDown(event) {
        if (!_setup && _validEvent(event)) {
            window.document.addEventListener("keyup", onKeyUp);
            window.document.addEventListener("mouseover", onMouseOver);
            window.document.addEventListener("mouseout", onMouseOut);
            window.document.addEventListener("mousemove", onMouseMove);
            window.document.addEventListener("click", onClick);
            _localHighlight = new Highlight("#ecc", true);
            _setup = true;
        }
    }
    
    /** Public Commands **********************************************************/

    // keep alive. Called once a second when a Live Development connection is active.
    // If several seconds have passed without this method being called, we can assume
    // that the connection has been severed and we should remove all our code/hooks.
    function keepAlive() {
        lastKeepAliveTime = Date.now();
    }

    // show goto
    function showGoto(targets) {
        if (!_currentMenu) {
            return;
        }
        _currentMenu.createBody();
        var i;
        for (i in targets) {
            _currentMenu.addItem(targets[i]);
        }
        _currentMenu.show();
    }

    // remove active highlights
    function hideHighlight() {
        if (_remoteHighlight) {
            _remoteHighlight.clear();
            _remoteHighlight = null;
        }
    }

    // highlight a node
    function highlight(node, clear) {
        if (!_remoteHighlight) {
            _remoteHighlight = new Highlight("#cfc");
        }
        if (clear) {
            _remoteHighlight.clear();
        }
        _remoteHighlight.add(node, true);
    }

    // highlight a rule
    function highlightRule(rule) {
        hideHighlight();
        var i, nodes = window.document.querySelectorAll(rule);
        for (i = 0; i < nodes.length; i++) {
            highlight(nodes[i]);
        }
        _remoteHighlight.selector = rule;
    }

    // redraw active highlights
    function redrawHighlights() {
        if (_remoteHighlight) {
            _remoteHighlight.redraw();
        }
    }

    window.addEventListener("resize", redrawHighlights);
    // Add a capture-phase scroll listener to update highlights when
    // any element scrolls.

    function _scrollHandler(e) {
        // Document scrolls can be updated immediately. Any other scrolls
        // need to be updated on a timer to ensure the layout is correct.
        if (e.target === window.document) {
            redrawHighlights();
        } else {
            if (_remoteHighlight || _localHighlight) {
                window.setTimeout(redrawHighlights, 0);
            }
        }
    }

    window.addEventListener("scroll", _scrollHandler, true);

    var aliveTest = window.setInterval(function () {
        if (Date.now() > lastKeepAliveTime + KEEP_ALIVE_TIMEOUT) {
            // Remove highlights
            hideHighlight();

            // Remove listeners
            window.removeEventListener("resize", redrawHighlights);
            window.removeEventListener("scroll", _scrollHandler, true);

            // Clear this interval
            window.clearInterval(aliveTest);
        }
    }, 1000);

    /**
     * Constructor
     * @param {Document} htmlDocument
     */
    function DOMEditHandler(htmlDocument) {
        this.htmlDocument = htmlDocument;
        this.rememberedNodes = null;
        this.entityParseParent = htmlDocument.createElement("div");
    }

    /**
     * @private
     * Find the first matching element with the specified data-brackets-id
     * @param {string} id
     * @return {Element}
     */
    DOMEditHandler.prototype._queryBracketsID = function (id) {
        if (!id) {
            return null;
        }

        if (this.rememberedNodes && this.rememberedNodes[id]) {
            return this.rememberedNodes[id];
        }

        var results = this.htmlDocument.querySelectorAll("[data-brackets-id='" + id + "']");
        return results && results[0];
    };

    /**
     * @private
     * Insert a new child element
     * @param {Element} targetElement Parent element already in the document
     * @param {Element} childElement New child element
     * @param {Object} edit
     */
    DOMEditHandler.prototype._insertChildNode = function (targetElement, childElement, edit) {
        var before = this._queryBracketsID(edit.beforeID),
            after  = this._queryBracketsID(edit.afterID);

        if (edit.firstChild) {
            before = targetElement.firstChild;
        } else if (edit.lastChild) {
            after = targetElement.lastChild;
        }

        if (before) {
            targetElement.insertBefore(childElement, before);
        } else if (after && (after !== targetElement.lastChild)) {
            targetElement.insertBefore(childElement, after.nextSibling);
        } else {
            targetElement.appendChild(childElement);
        }
    };

    /**
     * @private
     * Given a string containing encoded entity references, returns the string with the entities decoded.
     * @param {string} text The text to parse.
     * @return {string} The decoded text.
     */
    DOMEditHandler.prototype._parseEntities = function (text) {
        // Kind of a hack: just set the innerHTML of a div to the text, which will parse the entities, then
        // read the content out.
        var result;
        this.entityParseParent.innerHTML = text;
        result = this.entityParseParent.textContent;
        this.entityParseParent.textContent = "";
        return result;
    };

    /**
     * @private
     * @param {Node} node
     * @return {boolean} true if node expects its content to be raw text (not parsed for entities) according to the HTML5 spec.
     */
    function _isRawTextNode(node) {
        return (node.nodeType === Node.ELEMENT_NODE && /script|style|noscript|noframes|noembed|iframe|xmp/i.test(node.tagName));
    }

    /**
     * @private
     * Replace a range of text and comment nodes with an optional new text node
     * @param {Element} targetElement
     * @param {Object} edit
     */
    DOMEditHandler.prototype._textReplace = function (targetElement, edit) {
        function prevIgnoringHighlights(node) {
            do {
                node = node.previousSibling;
            } while (node && node.className === HIGHLIGHT_CLASSNAME);
            return node;
        }
        function nextIgnoringHighlights(node) {
            do {
                node = node.nextSibling;
            } while (node && node.className === HIGHLIGHT_CLASSNAME);
            return node;
        }
        function lastChildIgnoringHighlights(node) {
            node = (node.childNodes.length ? node.childNodes.item(node.childNodes.length - 1) : null);
            if (node && node.className === HIGHLIGHT_CLASSNAME) {
                node = prevIgnoringHighlights(node);
            }
            return node;
        }

        var start           = (edit.afterID)  ? this._queryBracketsID(edit.afterID)  : null,
            startMissing    = edit.afterID && !start,
            end             = (edit.beforeID) ? this._queryBracketsID(edit.beforeID) : null,
            endMissing      = edit.beforeID && !end,
            moveNext        = start && nextIgnoringHighlights(start),
            current         = moveNext || (end && prevIgnoringHighlights(end)) || lastChildIgnoringHighlights(targetElement),
            next,
            textNode        = (edit.content !== undefined) ? this.htmlDocument.createTextNode(_isRawTextNode(targetElement) ? edit.content : this._parseEntities(edit.content)) : null,
            lastRemovedWasText,
            isText;

        // remove all nodes inside the range
        while (current && (current !== end)) {
            isText = current.nodeType === Node.TEXT_NODE;

            // if start is defined, delete following text nodes
            // if start is not defined, delete preceding text nodes
            next = (moveNext) ? nextIgnoringHighlights(current) : prevIgnoringHighlights(current);

            // only delete up to the nearest element.
            // if the start/end tag was deleted in a prior edit, stop removing
            // nodes when we hit adjacent text nodes
            if ((current.nodeType === Node.ELEMENT_NODE) ||
                    ((startMissing || endMissing) && (isText && lastRemovedWasText))) {
                break;
            } else {
                lastRemovedWasText = isText;

                if (current.remove) {
                    current.remove();
                } else if (current.parentNode && current.parentNode.removeChild) {
                    current.parentNode.removeChild(current);
                }
                current = next;
            }
        }

        if (textNode) {
            // OK to use nextSibling here (not nextIgnoringHighlights) because we do literally
            // want to insert immediately after the start tag.
            if (start && start.nextSibling) {
                targetElement.insertBefore(textNode, start.nextSibling);
            } else if (end) {
                targetElement.insertBefore(textNode, end);
            } else {
                targetElement.appendChild(textNode);
            }
        }
    };

    /**
     * @private
     * Apply an array of DOM edits to the document
     * @param {Array.<Object>} edits
     */
    DOMEditHandler.prototype.apply = function (edits) {
        var targetID,
            targetElement,
            childElement,
            reparseResources = false,
            self = this;

        this.rememberedNodes = {};

        edits.forEach(function (edit) {
            var editIsSpecialTag = edit.type === "elementInsert" && (edit.tag === "html" || edit.tag === "head" || edit.tag === "body");

            if (edit.type === "rememberNodes") {
                edit.tagIDs.forEach(function (tagID) {
                    var node = self._queryBracketsID(tagID);
                    self.rememberedNodes[tagID] = node;
                    if (node.remove) {
                        node.remove();
                    } else if (node.parentNode && node.parentNode.removeChild) {
                        node.parentNode.removeChild(node);
                    }
                });
                return;
            }

            targetID = edit.type.match(/textReplace|textDelete|textInsert|elementInsert|elementMove/) ? edit.parentID : edit.tagID;
            targetElement = self._queryBracketsID(targetID);

            if (!targetElement && !editIsSpecialTag) {
                console.error("data-brackets-id=" + targetID + " not found");
                return;
            }

            switch (edit.type) {
            case "attrChange":
            case "attrAdd":
                targetElement.setAttribute(edit.attribute, self._parseEntities(edit.value));
                break;
            case "attrDelete":
                targetElement.removeAttribute(edit.attribute);
                break;
            case "elementDelete":
                if (targetElement.remove) {
                    targetElement.remove();
                } else if (targetElement.parentNode && targetElement.parentNode.removeChild) {
                    targetElement.parentNode.removeChild(targetElement);
                }
                break;
            case "elementInsert":
                childElement = null;
                if (editIsSpecialTag) {
                    // If we already have one of these elements (which we should), then
                    // just copy the attributes and set the ID.
                    childElement = self.htmlDocument[edit.tag === "html" ? "documentElement" : edit.tag];
                    if (!childElement) {
                        // Treat this as a normal insertion.
                        editIsSpecialTag = false;
                    }
                }
                if (!editIsSpecialTag) {
                    childElement = self.htmlDocument.createElement(edit.tag);
                }

                Object.keys(edit.attributes).forEach(function (attr) {
                    childElement.setAttribute(attr, self._parseEntities(edit.attributes[attr]));
                });
                childElement.setAttribute("data-brackets-id", edit.tagID);

                if (!editIsSpecialTag) {
                    self._insertChildNode(targetElement, childElement, edit);
                }
                break;
            case "elementMove":
                childElement = self._queryBracketsID(edit.tagID);
                self._insertChildNode(targetElement, childElement, edit);
                break;
            case "textInsert":
                var textElement = self.htmlDocument.createTextNode(_isRawTextNode(targetElement) ? edit.content : self._parseEntities(edit.content));
                self._insertChildNode(targetElement, textElement, edit);
                break;
            case "textReplace":
            case "textDelete":
                self._textReplace(targetElement, edit);
                break;
            }
        });

        this.rememberedNodes = {};

        // update highlight after applying diffs
        redrawHighlights();
    };

    function applyDOMEdits(edits) {
        _editHandler.apply(edits);
    }

    /**
     *
     * @param {Element} elem
     */
    function _domElementToJSON(elem) {
        var json = { tag: elem.tagName.toLowerCase(), attributes: {}, children: [] },
            i,
            len,
            node,
            value;

        len = elem.attributes.length;
        for (i = 0; i < len; i++) {
            node = elem.attributes.item(i);
            value = (node.name === "data-brackets-id") ? parseInt(node.value, 10) : node.value;
            json.attributes[node.name] = value;
        }

        len = elem.childNodes.length;
        for (i = 0; i < len; i++) {
            node = elem.childNodes.item(i);

            // ignores comment nodes and visuals generated by live preview
            if (node.nodeType === Node.ELEMENT_NODE && node.className !== HIGHLIGHT_CLASSNAME) {
                json.children.push(_domElementToJSON(node));
            } else if (node.nodeType === Node.TEXT_NODE) {
                json.children.push({ content: node.nodeValue });
            }
        }

        return json;
    }

    function getSimpleDOM() {
        return JSON.stringify(_domElementToJSON(window.document.documentElement));
    }
    
    function updateConfig(newConfig) {
        config = JSON.parse(newConfig);
        return JSON.stringify(config);
    }

    // init
    _editHandler = new DOMEditHandler(window.document);

    if (experimental) {
        window.document.addEventListener("keydown", onKeyDown);
    }
    
    var _ws = null;
    
    function _sendDataOverSocket(data) {
        if (_ws && _ws.readyState === WebSocket.OPEN) {
            console.warn("Sending data", data);
            _ws.send(data);
        }
    }
    
    function _indexOfRule(rules, rule) {
        var index;
        for (index in rules) {
            if (rules.hasOwnProperty(index)) {
                if (rules[index] === rule) {
                    return index;
                }
            }
        }
        return index;
    }
    
    function init() {
        // polyfill window.getMatchedCSSRules() in FireFox 6+
        if (typeof window.getMatchedCSSRules !== 'function') {
            var ELEMENT_RE = /[\w-]+/g,
                    ID_RE = /#[\w-]+/g,
                    CLASS_RE = /\.[\w-]+/g,
                    ATTR_RE = /\[[^\]]+\]/g,
                    // :not() pseudo-class does not add to specificity, but its content does as if it was outside it
                    PSEUDO_CLASSES_RE = /\:(?!not)[\w-]+(\(.*\))?/g,
                    PSEUDO_ELEMENTS_RE = /\:\:?(after|before|first-letter|first-line|selection)/g;
                // convert an array-like object to array
                function toArray(list) {
                    return [].slice.call(list);
                }

                // handles extraction of `cssRules` as an `Array` from a stylesheet or something that behaves the same
                function getSheetRules(stylesheet) {
                    var sheet_media = stylesheet.media && stylesheet.media.mediaText;
                    // if this sheet is disabled skip it
                    if ( stylesheet.disabled ) {
                        return [];
                    }
                    // if this sheet's media is specified and doesn't match the viewport then skip it
                    if ( sheet_media && sheet_media.length && ! window.matchMedia(sheet_media).matches ) {
                        return [];
                    }

                    try {
                        if (!stylesheet.cssRules) {
                            return [];
                        }
                    } catch(e) {
                        return [];
                    }

                    // get the style rules of this sheet
                    return toArray(stylesheet.cssRules);
                }

                function _find(string, re) {
                    var matches = string.match(re);
                    return matches ? matches.length : 0;
                }

                // calculates the specificity of a given `selector`
                function calculateScore(selector) {
                    var score = [0,0,0],
                        parts = selector.split(' '),
                        part, match;
                    //TODO: clean the ':not' part since the last ELEMENT_RE will pick it up
                    while (part = parts.shift(), typeof part == 'string') {
                        // find all pseudo-elements
                        match = _find(part, PSEUDO_ELEMENTS_RE);
                        score[2] += match;
                        // and remove them
                        match && (part = part.replace(PSEUDO_ELEMENTS_RE, ''));
                        // find all pseudo-classes
                        match = _find(part, PSEUDO_CLASSES_RE);
                        score[1] += match;
                        // and remove them
                        match && (part = part.replace(PSEUDO_CLASSES_RE, ''));
                        // find all attributes
                        match = _find(part, ATTR_RE);
                        score[1] += match;
                        // and remove them
                        match && (part = part.replace(ATTR_RE, ''));
                        // find all IDs
                        match = _find(part, ID_RE);
                        score[0] += match;
                        // and remove them
                        match && (part = part.replace(ID_RE, ''));
                        // find all classes
                        match = _find(part, CLASS_RE);
                        score[1] += match;
                        // and remove them
                        match && (part = part.replace(CLASS_RE, ''));
                        // find all elements
                        score[2] += _find(part, ELEMENT_RE);
                    }
                    return parseInt(score.join(''), 10);
                }

                // returns the heights possible specificity score an element can get from a give rule's selectorText
                function getSpecificityScore(element, selector_text) {
                    var selectors = selector_text.split(','),
                        selector, score, result = 0;
                    while (selector = selectors.shift()) {
                        if (matchesSelector(element, selector)) {
                            score = calculateScore(selector);
                            result = score > result ? score : result;
                        }
                    }
                    return result;
                }

                function sortBySpecificity(element, rules) {
                    // comparing function that sorts CSSStyleRules according to specificity of their `selectorText`
                    function compareSpecificity (a, b) {
                        return getSpecificityScore(element, b.selectorText) - getSpecificityScore(element, a.selectorText);
                    }

                    return rules.sort(compareSpecificity);
                }

                // Find correct matchesSelector impl
                function matchesSelector(el, selector) {
                  var matcher = el.matchesSelector || el.mozMatchesSelector ||
                      el.webkitMatchesSelector || el.oMatchesSelector || el.msMatchesSelector;
                  return matcher.apply(el,[selector]);
                }

                //TODO: not supporting 2nd argument for selecting pseudo elements
                //TODO: not supporting 3rd argument for checking author style sheets only
                window.getMatchedCSSRules = function (element /*, pseudo, author_only*/) {
                    var style_sheets, sheet, sheet_media,
                        rules, rule,
                        result = [];
                    // get stylesheets and convert to a regular Array
                    style_sheets = toArray(window.document.styleSheets);

                    // assuming the browser hands us stylesheets in order of appearance
                    // we iterate them from the beginning to follow proper cascade order
                    while (sheet = style_sheets.shift()) {
                        // get the style rules of this sheet
                        rules = getSheetRules(sheet);
                        // loop the rules in order of appearance
                        while (rule = rules.shift()) {
                            // if this is an @import rule
                            if (rule.styleSheet) {
                                // insert the imported stylesheet's rules at the beginning of this stylesheet's rules
                                rules = getSheetRules(rule.styleSheet).concat(rules);
                                // and skip this rule
                                continue;
                            }
                            // if there's no stylesheet attribute BUT there IS a media attribute it's a media rule
                            else if (rule.media) {
                                // insert the contained rules of this media rule to the beginning of this stylesheet's rules
                                rules = getSheetRules(rule).concat(rules);
                                // and skip it
                                continue;
                            }

                            // check if this element matches this rule's selector
                            if (matchesSelector(element, rule.selectorText)) {
                                // push the rule to the results set
                                result.push(rule);
                            }
                        }
                    }
                    // sort according to specificity
                    return sortBySpecificity(element, result);
                };
            }
    }

    function _getAcceptedProperty(key, element) {
        var lastSelectorUsed;
        var lastPriorityUsed;
        var indexUsed;
        
        var value = null, tmpValue;
        var isPrioritySet = false;
        var rule, i;
        var rulesets = window.getMatchedCSSRules(element) || [];
        value = element.style.getPropertyValue(key);
        var isDefaultPrioritySet = element.style.getPropertyPriority(key);
        lastPriorityUsed = isDefaultPrioritySet;
        
        for (i = rulesets.length - 1; i >= 0 && !isDefaultPrioritySet; i--) {
            rule = rulesets[i];
            tmpValue = rule.style.getPropertyValue(key);
            isPrioritySet = rule.style.getPropertyPriority(key);
            if (tmpValue) {
                if (!value) {
                    value = tmpValue;
                    lastSelectorUsed = rule.selectorText;
                    lastPriorityUsed = isPrioritySet;
                    indexUsed = i;
                } else {
                    if (lastSelectorUsed === rule.selectorText) {
                        if (isPrioritySet || (!isPrioritySet && !lastPriorityUsed)) {
                            value = tmpValue;
                            lastSelectorUsed = rule.selectorText;
                            lastPriorityUsed = isPrioritySet;
                            indexUsed = i;
                        }
                    } else if (isPrioritySet) {
                        if (!lastPriorityUsed) {
                            value = tmpValue;
                            lastSelectorUsed = rule.selectorText;
                            lastPriorityUsed = isPrioritySet;
                            indexUsed = i;
                        }
                    }
                }
            }
        }
        return { name: key, selector: lastSelectorUsed || "", value: value || "", index: rulesets.length - indexUsed, priority: lastPriorityUsed};
    }
    
    function _createContentBoxMetadata(element) {
        return {
            width: _getAcceptedProperty("width", element),
            height: _getAcceptedProperty("height", element)
        };
    }
    
    function _createMarginBoxMetadata(element) {
        return {
            "margin": _getAcceptedProperty("margin", element),
            "margin-left": _getAcceptedProperty("margin-left", element),
            "margin-top": _getAcceptedProperty("margin-top", element),
            "margin-right": _getAcceptedProperty("margin-right", element),
            "margin-bottom": _getAcceptedProperty("margin-bottom", element)
        };
    }
    
    function _createBorderBoxMetadata(element) {
        return {
            "border": _getAcceptedProperty("border", element),
            "border-left": _getAcceptedProperty("border-left", element),
            "border-top": _getAcceptedProperty("border-top", element),
            "border-right": _getAcceptedProperty("border-right", element),
            "border-bottom": _getAcceptedProperty("border-bottom", element)
        };
    }
    
    function _createPaddingBoxMetadata(element) {
        return {
            "padding": _getAcceptedProperty("padding", element),
            "padding-left": _getAcceptedProperty("padding-left", element),
            "padding-top": _getAcceptedProperty("padding-top", element),
            "padding-right": _getAcceptedProperty("padding-right", element),
            "padding-bottom": _getAcceptedProperty("padding-bottom", element)
        };
    }
    
    function _createMarginBox(styles, element) {
        return {
            left : styles['margin-left'] || "-",
            right : styles['margin-right'] || "-",
            top : styles['margin-top'] || "-",
            bottom : styles['margin-bottom'] || "-",
            metadata : _createMarginBoxMetadata(element)
        };
    }
    
    function _createBorderBox(styles, element) {
        return {
            left : styles['border-left-width'] || "-",
            right : styles['border-right-width'] || "-",
            top : styles['border-top-width'] || "-",
            bottom : styles['border-bottom-width'] || "-",
            metadata : _createBorderBoxMetadata(element)
        };
    }
    
    function _createPaddingBox(styles, element) {
        return {
            left : styles['padding-left'] || "-",
            right : styles['padding-right'] || "-",
            top : styles['padding-top'] || "-",
            bottom : styles['padding-bottom'] || "-",
            metadata : _createPaddingBoxMetadata(element)
        };
    }
    
    function _createContentBox(styles, element) {
        return {
            width : styles.width || "-",
            height : styles.height || "-",
            metadata : _createContentBoxMetadata(element)
        };
    }
    
    
    function _createBoxModelData(element) {
        var computedStyles = window.getComputedStyle(element);
        return {
            margin : _createMarginBox(computedStyles, element),
            border : _createBorderBox(computedStyles, element),
            padding : _createPaddingBox(computedStyles, element),
            content : _createContentBox(computedStyles, element)
        };
    }
    
    function _stringifyLiveData(element) {
        var rulesets = window.getMatchedCSSRules(element) || [];
        var counter = rulesets.length - 1;
        var ruleList = [];//{};
        var styleSheetPath, pathEntry, ruleObj, ruleIndex = -1, parentRuleIndex = -1;
        
        while (counter >= 0) {
            styleSheetPath = rulesets[counter].parentStyleSheet.href || "";
            if (styleSheetPath) {
                styleSheetPath = styleSheetPath.replace(window.location.origin, "").split('%20').join(' ');
                if (rulesets[counter].parentRule) {
                    parentRuleIndex = _indexOfRule(rulesets[counter].parentStyleSheet.cssRules, rulesets[counter].parentRule);
                    ruleIndex = _indexOfRule(rulesets[counter].parentRule.cssRules, rulesets[counter]);
                } else {
                    ruleIndex = _indexOfRule(rulesets[counter].parentStyleSheet.cssRules, rulesets[counter]);
                }
                if (rulesets[counter].parentRule && rulesets[counter].parentRule.media) {
                    ruleObj = { selectorText: rulesets[counter].selectorText,
                                index: ruleIndex,
                                href: styleSheetPath,
                                media: rulesets[counter].parentRule.media[0],
                                parentIndex: parentRuleIndex
                            };
                } else {
                    ruleObj = { selectorText: rulesets[counter].selectorText,
                                index: ruleIndex,
                                href: styleSheetPath
                            };
                }
                ruleList.push(ruleObj);
                counter--;
            }
        }
        return JSON.stringify(ruleList);
    }
    
    function _stringyfyNodePath(lastselectedElement) {
        var hrchy = [];
        var element = lastselectedElement;
        if (lastselectedElement) {
            while (element !== null && element.hasAttribute('data-brackets-id')) {
                hrchy.push({label: element.tagName, target: element.getAttribute('data-brackets-id')});
                element = element.parentElement;
            }
        }
        
        return JSON.stringify(hrchy);
    }
        
    function _sendLiveInspectionData(element, isRefresh) {
        var livedata = _stringifyLiveData(element),
            elmXPath = _stringyfyNodePath(element),
            msg      = JSON.stringify({data: livedata, path: elmXPath, boxmodel: _createBoxModelData(element), refresh: isRefresh || false});

        _sendDataOverSocket(JSON.stringify({
            type: "livedata",
            message: msg
        }));
        
        lastHiglightedElement = element;
    }
    
    function onDocumentClick(event, target) {
        var element = target || event.target,
            currentDataId,
            newDataId;
        
        if (_ws && element && element.hasAttribute('data-brackets-id')) {
            _sendDataOverSocket(JSON.stringify({
                type: "message",
                message: element.getAttribute('data-brackets-id')
            }));
        }
        
        setTimeout(function () {
            _sendLiveInspectionData(element);
        }, 0);
    }
    
    function _getMajorDOMAttrStr(element) {
        var tagStr = element.tagName;
        if (element.id) {
            tagStr += '#';
            tagStr += element.id;
        } else {
            if (element.classList.length) {
                tagStr += '.';
                tagStr += element.classList.value.split(/\s/).join('.');
            }
        }
        return tagStr + " ";
    }
      
    function _createInpectPane() {
        if (window.document.getElementById('preview-mask')) {
            return;
        }
        var inspectPane = window.document.createElement('div');
        inspectPane.id = "preview-mask";
        inspectPane.innerHTML = '<div id="preview" class="margin" name="margin" style="border-color: rgba(246, 178, 107, 0.658824);position:absolute;border-style:solid;margin:0px !important;padding:0px !important;"><div class="border" name="border" accesskey="" style="border-color: rgba(255, 229, 153, 0.658824);border-style:solid;margin:0px !important;padding:0px !important;"><div class="padding" name="padding" style="border-color: rgba(147, 196, 125, 0.54902);border-style:solid;margin:0px !important;padding:0px !important;"><div class="content" style="background-color: rgba(111, 168, 220, 0.658824);"></div></div></div></div>';
        
        inspectPane.style.cssText = "position: fixed; width: 100%; height: 100%; top: 0px; left: 0px; overflow: hidden; pointer-events: all;z-index:1000000;";
        window.document.body.append(inspectPane);
        inspectPane = window.document.getElementById('preview-mask');
        
        var inspectWindow = window,
            inspectDOM = window.document,
            preview = inspectDOM.getElementById('preview-mask');
                
            
        preview.addEventListener('mousemove', function (event) {
            preview.style.pointerEvents = 'none';
            var targetElement = inspectDOM.elementFromPoint(event.clientX, event.clientY);
            var computedStyles = inspectWindow.getComputedStyle(targetElement);
            preview.style.pointerEvents = 'all';
            var rect = targetElement.getBoundingClientRect();
            var previewMask = inspectDOM.getElementsByClassName('content')[0];
            
            var titleStr = _getMajorDOMAttrStr(targetElement) + '| ' + rect.width + 'x' + rect.height;
            
            var vertPaddingComp = parseInt(computedStyles['padding-top'], 10) + parseInt(computedStyles['padding-bottom'], 10),
                horzPaddingComp = parseInt(computedStyles['padding-left'], 10) + parseInt(computedStyles['padding-right'], 10);

            var computedWidth = (rect.width - horzPaddingComp) + 'px',
                computedHeight = (rect.height - vertPaddingComp) + 'px';

            previewMask.style.width = computedWidth;
            previewMask.style.height = computedHeight;

            previewMask = previewMask.parentElement;

            previewMask.style.borderLeftWidth = computedStyles['padding-left'];
            previewMask.style.borderRightWidth = computedStyles['padding-right'];
            previewMask.style.borderTopWidth = computedStyles['padding-top'];
            previewMask.style.borderBottomWidth = computedStyles['padding-bottom'];

            previewMask = previewMask.parentElement;

            previewMask.style.borderLeftWidth = computedStyles['border-left-width'];
            previewMask.style.borderRightWidth = computedStyles['border-right-width'];
            previewMask.style.borderTopWidth = computedStyles['border-top-width'];
            previewMask.style.borderBottomWidth = computedStyles['border-bottom-width'];

            previewMask = previewMask.parentElement;

            previewMask.style.borderLeftWidth = computedStyles['margin-left'];
            previewMask.style.borderRightWidth = computedStyles['margin-right'];
            previewMask.style.borderTopWidth = computedStyles['margin-top'];
            previewMask.style.borderBottomWidth = computedStyles['margin-bottom'];

            previewMask.style.left = (rect.left - parseInt(computedStyles['margin-left'], 10)) + 'px';
            previewMask.style.top = (rect.top - parseInt(computedStyles['margin-top'], 10)) + 'px';
            
            previewMask.title = titleStr;

        });

        inspectPane.addEventListener('click', function (event) {
            inspectPane.style.pointerEvents = 'none';
            var targetElement = inspectDOM.elementFromPoint(event.clientX, event.clientY);
            inspectPane.style.pointerEvents = 'all';
            onDocumentClick(event, targetElement);
        });
        
    }
    
    function _removeInspectPane() {
        var inspectPane = window.document.getElementById('preview-mask');
        if (inspectPane) {
            inspectPane.remove();
        }
    }

    var refreshScheduleID;
    
    function _refreshLiveData() {
        if (lastHiglightedElement) {
            if (refreshScheduleID) {
                window.clearTimeout(refreshScheduleID);
            }
            refreshScheduleID = window.setTimeout(function () {
                _sendLiveInspectionData(lastHiglightedElement, true);
            }, 400);
        }
    }
    
    function _refreshBoxModelData() {
        var msg = JSON.stringify({path: _stringyfyNodePath(lastHiglightedElement), boxmodel: _createBoxModelData(lastHiglightedElement), livedataRefresh: true});
        _sendDataOverSocket(JSON.stringify({
            type: "livedata",
            message: msg
        }));
    }
    
    function createWebSocket() {
        _ws = new WebSocket("ws://localhost:" + remoteWSPort);
        _ws.onopen = function () {
            _collateResources();
            window.document.addEventListener("DOMContentLoaded", _collateResources);
            window.document.addEventListener("unload", _collateResources);
            window.addEventListener("resize", _refreshLiveData);
        };
        
        _ws.onmessage = function (evt) {
            var data = JSON.parse(evt.data);
            if (data.resourcedataRefresh) {
                _collateResources();
            } else if (data.livedataRefresh) {
                _refreshBoxModelData();
            } else if (data.inspect) {
                _createInpectPane();
            } else {
                _removeInspectPane();
            }
        };
                
        _ws.onclose = function () {
            // websocket is closed
            window.document.removeEventListener("DOMContentLoaded", _collateResources);
            window.document.removeEventListener("unload", _collateResources);
            window.removeEventListener("resize", _refreshLiveData);
        };
    }
    
    if (remoteWSPort) {
        createWebSocket();
        init();
    }
    
    return {
        "DOMEditHandler"        : DOMEditHandler,
        "keepAlive"             : keepAlive,
        "showGoto"              : showGoto,
        "hideHighlight"         : hideHighlight,
        "highlight"             : highlight,
        "highlightRule"         : highlightRule,
        "redrawHighlights"      : redrawHighlights,
        "applyDOMEdits"         : applyDOMEdits,
        "getSimpleDOM"          : getSimpleDOM,
        "updateConfig"          : updateConfig
    };
}
