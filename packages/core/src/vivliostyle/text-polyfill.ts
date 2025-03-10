/**
 * Copyright 2021 Vivliostyle Foundation
 *
 * Vivliostyle.js is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * Vivliostyle.js is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with Vivliostyle.js.  If not, see <http://www.gnu.org/licenses/>.
 *
 * @fileoverview TextPolyfill - CSS text-spacing and hanging-punctuation support.
 */
import * as Base from "./base";
import * as Css from "./css";
import * as Plugin from "./plugin";
import * as Vtree from "./vtree";

type PropertyValue = string | number | Css.Val;

type HangingPunctuation = {
  first: boolean;
  end: boolean; // force-end or allow-end
  allowEnd: boolean;
  last: boolean;
};

const HANGING_PUNCTUATION_NONE: HangingPunctuation = {
  first: false,
  end: false,
  allowEnd: false,
  last: false,
};

function hangingPunctuationFromPropertyValue(
  value: PropertyValue,
): HangingPunctuation {
  const cssval =
    value instanceof Css.Val
      ? value
      : typeof value === "string"
      ? Css.getName(value)
      : Css.ident.none;

  if (cssval === Css.ident.none) {
    return HANGING_PUNCTUATION_NONE;
  }
  const values = cssval instanceof Css.SpaceList ? cssval.values : [cssval];
  const hangingPunctuation: HangingPunctuation = Object.create(
    HANGING_PUNCTUATION_NONE,
  );

  for (const val of values) {
    if (val instanceof Css.Ident) {
      switch (val.name) {
        case "first":
          hangingPunctuation.first = true;
          break;
        case "force-end":
          hangingPunctuation.end = true;
          break;
        case "allow-end":
          hangingPunctuation.end = true;
          hangingPunctuation.allowEnd = true;
          break;
        case "last":
          hangingPunctuation.last = true;
          break;
      }
    }
  }
  return hangingPunctuation;
}

function isHangingPunctuationNone(
  hangingPunctuation: HangingPunctuation,
): boolean {
  return (
    !hangingPunctuation.first &&
    !hangingPunctuation.last &&
    !hangingPunctuation.end
  );
}

type TextSpacing = {
  trimStart: boolean; // trim-start or space-first (not space-start)
  spaceFirst: boolean; // space-first (trim-start except at first line)
  trimEnd: boolean; // trim-end or allow-end (not space-end)
  allowEnd: boolean; // allow-end (not force-end)
  trimAdjacent: boolean;
  ideographAlpha: boolean;
  ideographNumeric: boolean;
};

/**
 * text-spacing: none
 * none = space-start space-end space-adjacent
 */
const TEXT_SPACING_NONE: TextSpacing = {
  trimStart: false,
  spaceFirst: false,
  trimEnd: false,
  allowEnd: false,
  trimAdjacent: false,
  ideographAlpha: false,
  ideographNumeric: false,
};

/**
 * text-spacing: normal
 * normal = space-first trim-end trim-adjacent ideograph-alpha ideograph-numeric
 */
const TEXT_SPACING_NORMAL: TextSpacing = {
  trimStart: true,
  spaceFirst: true,
  trimEnd: true,
  allowEnd: false,
  trimAdjacent: true,
  ideographAlpha: true,
  ideographNumeric: true,
};

/**
 * text-spacing: auto
 * auto = trim-start trim-end trim-adjacent ideograph-alpha ideograph-numeric
 */
const TEXT_SPACING_AUTO: TextSpacing = {
  trimStart: true,
  spaceFirst: false,
  trimEnd: true,
  allowEnd: false,
  trimAdjacent: true,
  ideographAlpha: true,
  ideographNumeric: true,
};

/**
 * text-spacing base setting
 * = space-first trim-end trim-adjacent
 * (= normal except ideograph-alpha and ideograph-numeric)
 */
const TEXT_SPACING_BASE: TextSpacing = {
  trimStart: true,
  spaceFirst: true,
  trimEnd: true,
  allowEnd: false,
  trimAdjacent: true,
  ideographAlpha: false,
  ideographNumeric: false,
};

function textSpacingFromPropertyValue(value: PropertyValue): TextSpacing {
  const cssval =
    value instanceof Css.Val
      ? value
      : typeof value === "string"
      ? Css.getName(value)
      : Css.ident.normal;

  if (cssval === Css.ident.normal) {
    return TEXT_SPACING_NORMAL;
  }
  if (cssval === Css.ident.none) {
    return TEXT_SPACING_NONE;
  }
  if (cssval === Css.ident.auto) {
    return TEXT_SPACING_AUTO;
  }
  const values = cssval instanceof Css.SpaceList ? cssval.values : [cssval];
  const textSpacing: TextSpacing = Object.create(TEXT_SPACING_BASE);

  for (const val of values) {
    if (val instanceof Css.Ident) {
      switch (val.name) {
        case "trim-start":
          textSpacing.trimStart = true;
          textSpacing.spaceFirst = false;
          break;
        case "space-start":
          textSpacing.trimStart = false;
          textSpacing.spaceFirst = false;
          break;
        case "space-first":
          textSpacing.trimStart = true;
          textSpacing.spaceFirst = true;
          break;
        case "trim-end":
          textSpacing.trimEnd = true;
          textSpacing.allowEnd = false;
          break;
        case "space-end":
          textSpacing.trimEnd = false;
          textSpacing.allowEnd = false;
          break;
        case "allow-end":
          textSpacing.trimEnd = true;
          textSpacing.allowEnd = true;
          break;
        case "trim-adjacent":
          textSpacing.trimAdjacent = true;
          break;
        case "space-adjacent":
          textSpacing.trimAdjacent = false;
          break;
        case "ideograph-alpha":
          textSpacing.ideographAlpha = true;
          break;
        case "ideograph-numeric":
          textSpacing.ideographNumeric = true;
          break;
      }
    }
  }

  return textSpacing;
}

function isTextSpacingNone(textSpacing: TextSpacing): boolean {
  return (
    !textSpacing.trimStart &&
    !textSpacing.trimEnd &&
    !textSpacing.trimAdjacent &&
    !textSpacing.ideographAlpha &&
    !textSpacing.ideographNumeric
  );
}

function normalizeLang(lang: string): string | null {
  if (lang) {
    // Normalize CJK lang
    lang = lang.toLowerCase();
    if (/^zh\b.*-(hant|tw|hk)\b/.test(lang)) {
      return "zh-hant";
    }
    if (/^zh\b/.test(lang)) {
      return "zh-hans";
    }
    if (/^ja\b/.test(lang)) {
      return "ja";
    }
    if (/^ko\b/.test(lang)) {
      return "ko";
    }
    return lang;
  }
  return null;
}

const embeddedContentTags = {
  audio: true,
  canvas: true,
  embed: true,
  iframe: true,
  img: true,
  math: true,
  object: true,
  picture: true,
  svg: true,
  video: true,
};

class TextSpacingPolyfill {
  getPolyfilledInheritedProps() {
    return ["hanging-punctuation", "text-spacing"];
  }

  preprocessSingleDocument(document: Document): void {
    if (!document.body) {
      return;
    }
    this.preprocessForTextSpacing(document.body);
  }

  preprocessForTextSpacing(element: Element): void {
    // Split text nodes by punctuations and ideograph/non-ideograph boundary
    const nodeIter = element.ownerDocument.createNodeIterator(
      element,
      NodeFilter.SHOW_TEXT,
    );
    for (let node = nodeIter.nextNode(); node; node = nodeIter.nextNode()) {
      if (
        node.parentElement.namespaceURI !== Base.NS.XHTML ||
        node.parentElement.dataset?.["mathTypeset"] === "true"
      ) {
        continue;
      }
      const textArr = node.textContent
        .replace(
          /(?![()\[\]{}])[\p{Ps}\p{Pe}\p{Pf}\p{Pi}、。，．：；､｡\u3000]\p{M}*(?=\P{M})|.(?=(?![()\[\]{}])[\p{Ps}\p{Pe}\p{Pf}\p{Pi}、。，．：；､｡\u3000])|(?!\p{P})[\p{sc=Han}\u3041-\u30FF\u31C0-\u31FF]\p{M}*(?=(?![\p{sc=Han}\u3041-\u30FF\u31C0-\u31FF\uFF01-\uFF60])[\p{L}\p{Nd}])|(?![\p{sc=Han}\u3041-\u30FF\u31C0-\u31FF\uFF01-\uFF60])[\p{L}\p{Nd}]\p{M}*(?=(?!\p{P})[\p{sc=Han}\u3041-\u30FF\u31C0-\u31FF])/gsu,
          "$&\x00",
        )
        .split("\x00");

      if (textArr.length > 1) {
        const lastIndex = textArr.length - 1;
        for (let i = 0; i < lastIndex; i++) {
          node.parentNode.insertBefore(
            document.createTextNode(textArr[i]),
            node,
          );
        }
        node.textContent = textArr[lastIndex];
      }
    }
  }

  processGeneratedContent(
    element: HTMLElement,
    textSpacingVal: Css.Val,
    hangingPunctuationVal: Css.Val,
    lang: string,
    vertical: boolean,
  ): void {
    lang = normalizeLang(lang);
    const textSpacing = textSpacingFromPropertyValue(textSpacingVal);
    const hangingPunctuation = hangingPunctuationFromPropertyValue(
      hangingPunctuationVal,
    );

    if (
      isHangingPunctuationNone(hangingPunctuation) &&
      isTextSpacingNone(textSpacing)
    ) {
      return;
    }

    this.preprocessForTextSpacing(element);

    const whiteSpaceSave = element.style.whiteSpace;
    if ((vertical ? element.offsetHeight : element.offsetWidth) === 0) {
      // Prevent wrong line wrapping
      element.style.whiteSpace = "pre";
    }

    const nodeIter = element.ownerDocument.createNodeIterator(
      element,
      NodeFilter.SHOW_TEXT,
    );
    let prevNode: Node = null;
    let nextNode: Node = null;
    for (let node = nodeIter.nextNode(); node; node = nextNode) {
      nextNode = nodeIter.nextNode();
      const isFirstInBlock = !prevNode;
      const isFirstAfterForcedLineBreak =
        !prevNode || /\n$/.test(prevNode.textContent);
      const isLastBeforeForcedLineBreak =
        !nextNode || /^\n/.test(nextNode.textContent);
      const isLastInBlock = !nextNode;
      this.processTextSpacing(
        node,
        isFirstInBlock || isFirstAfterForcedLineBreak,
        isFirstInBlock,
        isFirstAfterForcedLineBreak,
        isLastBeforeForcedLineBreak,
        isLastInBlock,
        prevNode,
        nextNode,
        textSpacing,
        hangingPunctuation,
        lang,
        vertical,
      );
      prevNode = node;
    }

    element.style.whiteSpace = whiteSpaceSave;
  }

  postLayoutBlock(
    nodeContext: Vtree.NodeContext,
    checkPoints: Vtree.NodeContext[],
  ): void {
    const isFirstFragment =
      !nodeContext ||
      (nodeContext.fragmentIndex === 1 && checkIfFirstInBlock());
    const isAfterForcedLineBreak =
      isFirstFragment || checkIfAfterForcedLineBreak();

    function isOutOfLine(node: Node): boolean {
      if (node?.nodeType !== 1) {
        return false;
      }
      const elem = node as HTMLElement;
      if (elem.hasAttribute(Vtree.SPECIAL_ATTR)) {
        return true;
      }
      const { position, float } = elem.style ?? {};
      return (
        position === "absolute" ||
        position === "fixed" ||
        (float && float !== "none")
      );
    }

    function checkIfFirstInBlock(): boolean {
      let p = checkPoints[0];
      let viewNode = p.viewNode;
      while (p && p.inline) {
        p = p.parent;
      }
      if (p?.fragmentIndex !== 1) {
        return false;
      }
      for (
        let prev = viewNode.previousSibling;
        prev;
        prev = prev.previousSibling
      ) {
        if (!isOutOfLine(prev)) {
          return false;
        }
      }
      return true;
    }

    function checkIfAfterForcedLineBreak(): boolean {
      let p = checkPoints[0];
      let prevNode: Node;
      while (p && p.inline) {
        prevNode = p.sourceNode?.previousSibling;
        if (prevNode) {
          if (
            prevNode.nodeType === 3 &&
            /^[ \t\r\n\f]*$/.test(prevNode.textContent) &&
            p.whitespace !== Vtree.Whitespace.PRESERVE
          ) {
            prevNode = prevNode.previousSibling;
          }
          if (prevNode) {
            break;
          }
        }
        p = p.parent;
      }

      while (prevNode) {
        if (prevNode.nodeType === 1) {
          if ((prevNode as Element).localName === "br") {
            return true;
          }
        } else if (prevNode.nodeType === 3) {
          if (p.whitespace === Vtree.Whitespace.PRESERVE) {
            if (/\n$/.test(prevNode.textContent)) {
              return true;
            }
          } else if (p.whitespace === Vtree.Whitespace.NEWLINE) {
            if (/\n[ \t\r\n\f]*$/.test(prevNode.textContent)) {
              return true;
            }
          }
        }
        prevNode = prevNode.lastChild;
      }
      return false;
    }

    for (let i = 0; i < checkPoints.length; i++) {
      const p = checkPoints[i];
      if (
        !p.after &&
        p.inline &&
        !p.display &&
        p.parent &&
        p.viewNode.parentNode &&
        p.viewNode.nodeType === Node.TEXT_NODE &&
        !Vtree.canIgnore(p.viewNode, p.whitespace)
      ) {
        const lang = normalizeLang(
          p.lang ??
            p.parent.lang ??
            nodeContext?.lang ??
            nodeContext?.parent?.lang,
        );
        const textSpacing = textSpacingFromPropertyValue(
          p.inheritedProps["text-spacing"],
        );
        const hangingPunctuation = hangingPunctuationFromPropertyValue(
          p.inheritedProps["hanging-punctuation"],
        );

        if (
          isHangingPunctuationNone(hangingPunctuation) &&
          isTextSpacingNone(textSpacing)
        ) {
          continue;
        }
        if (/\b(flex|grid)\b/.test(p.parent.display)) {
          // Cannot process if parent is flex or grid. (Issue #926)
          continue;
        }

        let prevNode: Node = null;
        let nextNode: Node = null;
        let isFirstAfterBreak = i === 0;
        let isFirstInBlock = i === 0 && isFirstFragment;
        let isFirstAfterForcedLineBreak = i === 0 && isAfterForcedLineBreak;
        let isLastBeforeForcedLineBreak = false;
        let isLastInBlock = false;

        function checkIfFirstAfterForcedLineBreak(
          prevP: Vtree.NodeContext,
        ): boolean {
          if (prevP.viewNode?.nodeType === 1) {
            return (prevP.viewNode as Element).localName === "br";
          }
          if (prevP.viewNode?.nodeType === 3) {
            if (prevP.whitespace === Vtree.Whitespace.PRESERVE) {
              if (/\n$/.test(prevP.viewNode.textContent)) {
                return true;
              }
            } else if (prevP.whitespace === Vtree.Whitespace.NEWLINE) {
              if (/\n[ \t\r\n\f]*$/.test(prevP.viewNode.textContent)) {
                return true;
              }
            }
            if (
              (prevP.viewNode as Element).previousElementSibling?.localName ===
              "br"
            ) {
              return Vtree.canIgnore(prevP.viewNode, prevP.whitespace);
            }
          }
          return false;
        }

        function checkIfLastBeforeForcedLineBreak(
          nextP: Vtree.NodeContext,
        ): boolean {
          if (nextP.viewNode?.nodeType === 1) {
            return (nextP.viewNode as Element).localName === "br";
          }
          if (nextP.viewNode?.nodeType === 3) {
            if (nextP.whitespace === Vtree.Whitespace.PRESERVE) {
              if (/^\n/.test(nextP.viewNode.textContent)) {
                return true;
              }
            } else if (nextP.whitespace === Vtree.Whitespace.NEWLINE) {
              if (/^[ \t\r\n\f]*\n/.test(nextP.viewNode.textContent)) {
                return true;
              }
            }
            if (
              (nextP.viewNode as Element).nextElementSibling?.localName === "br"
            ) {
              return Vtree.canIgnore(nextP.viewNode, nextP.whitespace);
            }
          }
          return false;
        }

        for (let prev = i - 1; prev >= 0; prev--) {
          const prevP = checkPoints[prev];
          if (checkIfFirstAfterForcedLineBreak(prevP)) {
            isFirstAfterForcedLineBreak = true;
            break;
          }
          if (
            !prevP.display &&
            prevP.viewNode.nodeType === Node.TEXT_NODE &&
            prevP.viewNode.textContent.length > 0
          ) {
            prevNode = prevP.viewNode;
            break;
          }
          if (
            (prevP.display && !/^(inline|ruby)\b/.test(prevP.display)) ||
            (prevP.viewNode?.nodeType === 1 &&
              ((prevP.viewNode as Element).localName === "br" ||
                embeddedContentTags[(prevP.viewNode as Element).localName]))
          ) {
            break;
          }
          if (prev === 0) {
            isFirstAfterBreak = true;
            if (isFirstFragment) {
              isFirstInBlock = true;
              isFirstAfterForcedLineBreak = true;
            }
          }
        }
        for (let next = i + 1; next < checkPoints.length; next++) {
          const nextP = checkPoints[next];
          if (checkIfLastBeforeForcedLineBreak(nextP)) {
            isLastBeforeForcedLineBreak = true;
            break;
          }
          if (
            nextP.viewNode !== p.viewNode &&
            !nextP.display &&
            nextP.viewNode.nodeType === Node.TEXT_NODE &&
            nextP.viewNode.textContent.length > 0
          ) {
            nextNode = nextP.viewNode;
            break;
          }
          if (
            (nextP.display && !/^(inline|ruby)\b/.test(nextP.display)) ||
            (nextP.viewNode?.nodeType === 1 &&
              ((nextP.viewNode as Element).localName === "br" ||
                embeddedContentTags[(nextP.viewNode as Element).localName]))
          ) {
            if (
              next === checkPoints.length - 1 &&
              isOutOfLine(nextP.viewNode)
            ) {
              isLastInBlock = true;
            }
            break;
          }
          if (next === checkPoints.length - 1) {
            isLastBeforeForcedLineBreak = true;
            isLastInBlock = true;
            for (
              let nextNext = nextP.viewNode.nextSibling;
              nextNext;
              nextNext = nextNext.nextSibling
            ) {
              if (!isOutOfLine(nextNext)) {
                isLastInBlock = false;
                break;
              }
            }
          }
        }
        this.processTextSpacing(
          p.viewNode,
          isFirstAfterBreak,
          isFirstInBlock,
          isFirstAfterForcedLineBreak,
          isLastBeforeForcedLineBreak,
          isLastInBlock,
          prevNode,
          nextNode,
          textSpacing,
          hangingPunctuation,
          lang,
          p.vertical,
        );
      }
    }
  }

  private processTextSpacing(
    textNode: Node,
    isFirstAfterBreak: boolean,
    isFirstInBlock: boolean,
    isFirstAfterForcedLineBreak: boolean,
    isLastBeforeForcedLineBreak: boolean,
    isLastInBlock: boolean,
    prevNode: Node,
    nextNode: Node,
    textSpacing: TextSpacing,
    hangingPunctuation: HangingPunctuation,
    lang: string,
    vertical: boolean,
  ): void {
    const text = textNode.textContent;
    const document = textNode.ownerDocument;
    let currRange: Range;
    let prevRange: Range;
    let nextRange: Range;

    function isAtStartOfLine(): boolean {
      if (isFirstAfterBreak) {
        return true;
      }
      if (!prevNode) {
        return false;
      }
      if (!currRange) {
        currRange = document.createRange();
        currRange.selectNode(textNode);
      }
      const rect = currRange.getClientRects()[0];
      if (!prevRange) {
        prevRange = document.createRange();
        prevRange.selectNode(prevNode);
      }
      const prevRects = prevRange.getClientRects();
      const prevRect = prevRects[prevRects.length - 1];
      if (!rect || !prevRect) {
        return false;
      }
      return vertical
        ? rect.top < prevRect.top + prevRect.height - rect.width ||
            rect.left + rect.width < prevRect.left + rect.width / 10 ||
            rect.left > prevRect.left + prevRect.width - rect.width / 10
        : rect.left < prevRect.left + prevRect.width - rect.height ||
            rect.top > prevRect.top + prevRect.height - rect.height / 10 ||
            rect.top + rect.height < prevRect.top + rect.height / 10;
    }

    function isAtEndOfLine(): boolean {
      if (!nextNode) {
        return false;
      }
      if (!currRange) {
        currRange = document.createRange();
        currRange.selectNode(textNode);
      }
      const rect = currRange.getClientRects()[0];
      if (!nextRange) {
        nextRange = document.createRange();
        nextRange.selectNode(nextNode);
      }
      const nextRect = nextRange.getClientRects()[0];
      if (!rect || !nextRect) {
        return false;
      }
      return vertical
        ? rect.top + rect.height > nextRect.top + rect.width ||
            rect.left > nextRect.left + nextRect.width - rect.width / 10 ||
            rect.left + rect.width < nextRect.left + rect.width / 10
        : rect.left + rect.width > nextRect.left + rect.height ||
            rect.top + rect.height < nextRect.top + rect.height / 10 ||
            rect.top > nextRect.top + nextRect.height - rect.height / 10;
    }

    let punctProcessing = false;
    let hangingFirst = false;
    let hangingLast = false;
    let hangingEnd = false;
    let tagName: "viv-ts-open" | "viv-ts-close";

    if (
      isFirstInBlock &&
      hangingPunctuation.first &&
      /^[\p{Ps}\p{Pf}\p{Pi}'"\u3000]\p{M}*$/u.test(text)
    ) {
      // hanging-punctuation: first
      tagName = "viv-ts-open";
      punctProcessing = true;
      hangingFirst = true;
    } else if (
      isLastInBlock &&
      hangingPunctuation.last &&
      /^[\p{Pe}\p{Pf}\p{Pi}'"]\p{M}*$/u.test(text)
    ) {
      // hanging-punctuation: last
      tagName = "viv-ts-close";
      punctProcessing = true;
      hangingLast = true;
    } else if (hangingPunctuation.end && /^[、。，．､｡]\p{M}*$/u.test(text)) {
      // hanging-punctuation: force-end | allow-end
      tagName = "viv-ts-close";
      punctProcessing = true;
      hangingEnd = true;
    } else if (
      (textSpacing.trimStart || textSpacing.trimAdjacent) &&
      /^[‘“〝（［｛｟〈〈《「『【〔〖〘〚]\p{M}*$/u.test(text)
    ) {
      // fullwidth opening punctuation
      tagName = "viv-ts-open";
      punctProcessing = true;
    } else if (
      (textSpacing.trimEnd || textSpacing.trimAdjacent) &&
      (/^[’”〞〟）］｝｠〉〉》」』】〕〗〙〛]\p{M}*$/u.test(text) ||
        (lang === "zh-hans" && /^[：；]\p{M}*$/u.test(text)) ||
        (lang !== "zh-hant" && /^[、。，．]\p{M}*$/u.test(text)))
    ) {
      // fullwidth closing punctuation
      tagName = "viv-ts-close";
      punctProcessing = true;
    }

    if (punctProcessing) {
      if (textNode.parentElement.localName === "viv-ts-inner") {
        // Already processed
        return;
      }
      // Wrap the textNode as `<{tagName}><viv-ts-inner>{text}<viv-ts-inner></{tagName}>`
      const outerElem = document.createElement(tagName);
      const innerElem = document.createElement("viv-ts-inner");
      outerElem.appendChild(innerElem);
      textNode.parentNode.insertBefore(outerElem, textNode);
      innerElem.appendChild(textNode);

      // Check if che punctuation is almost full width
      const fontSize = parseFloat(
        document.defaultView.getComputedStyle(outerElem).fontSize,
      );
      const fullWidthThreshold = fontSize * 0.7;
      const isFullWidth =
        (vertical ? innerElem.offsetHeight : innerElem.offsetWidth) >
        fullWidthThreshold;

      function linePosition(): number {
        return vertical ? outerElem.offsetLeft : outerElem.offsetTop;
      }

      if (isFullWidth || hangingFirst || hangingLast || hangingEnd) {
        if (tagName === "viv-ts-open") {
          if (hangingFirst) {
            outerElem.className = "viv-hang-first";
          } else if (isFirstInBlock || isFirstAfterForcedLineBreak) {
            if (textSpacing.trimStart && !textSpacing.spaceFirst) {
              outerElem.className = "viv-ts-trim";
            } else {
              outerElem.className = "viv-ts-space";
            }
          } else if (!textSpacing.trimStart && isAtStartOfLine()) {
            outerElem.className = "viv-ts-space";
          } else if (
            textSpacing.trimAdjacent &&
            prevNode &&
            /[\p{Ps}\p{Pi}\p{Pe}\p{Pf}\u00B7\u2027\u30FB\u3000：；、。，．]\p{M}*$/u.test(
              prevNode.textContent,
            ) &&
            // exclude non-fullwidth closing punctuations (Issue #1003)
            (!/[\p{Pe}\p{Pf}]\p{M}*$/u.test(prevNode.textContent) ||
              (prevNode.parentElement.localName === "viv-ts-inner" &&
                (vertical
                  ? prevNode.parentElement.offsetHeight
                  : prevNode.parentElement.offsetWidth) > fullWidthThreshold))
          ) {
            outerElem.className = "viv-ts-trim";
          } else if (textSpacing.trimStart && isAtStartOfLine()) {
            const linePos = linePosition();
            outerElem.className = "viv-ts-auto";
            if (linePos === linePosition() && !isAtStartOfLine()) {
              // workaround for issues #1005 and #1010
              outerElem.className = "viv-ts-trim";
            }
          }
        } else if (tagName === "viv-ts-close") {
          if (hangingLast) {
            outerElem.className = isFullWidth
              ? "viv-hang-last"
              : "viv-hang-last viv-hang-hw";
          } else if (isLastInBlock || isLastBeforeForcedLineBreak) {
            if (hangingEnd) {
              const { offsetLeft, offsetTop } = outerElem;
              outerElem.className = isFullWidth
                ? "viv-hang-end"
                : "viv-hang-end viv-hang-hw";
              if (
                outerElem.offsetLeft === offsetLeft &&
                outerElem.offsetTop === offsetTop
              ) {
                outerElem.className = "";
              }
            } else if (textSpacing.trimEnd) {
              outerElem.className = "viv-ts-trim";
            } else {
              outerElem.className = "viv-ts-space";
            }
          } else if (
            nextNode &&
            /^[\p{Pe}\p{Pf}\u00B7\u2027\u30FB\u3000：；、。，．]/u.test(
              nextNode.textContent,
            )
          ) {
            if (isFullWidth && textSpacing.trimAdjacent) {
              outerElem.className = "viv-ts-trim";
            }
          } else if (hangingEnd) {
            const atEnd = isAtEndOfLine();
            const atEndNoHang = atEnd && hangingPunctuation.allowEnd;
            if (!atEndNoHang) {
              outerElem.className = isFullWidth
                ? "viv-hang-end"
                : "viv-hang-end viv-hang-hw";
            }
            if (!isFullWidth) {
              if (!atEnd && !isAtEndOfLine()) {
                outerElem.className = "";
              }
            } else if (
              atEndNoHang &&
              textSpacing.trimEnd &&
              !textSpacing.allowEnd
            ) {
              outerElem.className = "viv-ts-auto";
            } else if (!atEndNoHang && !isAtEndOfLine()) {
              outerElem.className = "";
            } else if (!atEnd && hangingPunctuation.allowEnd) {
              if (!textSpacing.trimEnd || textSpacing.allowEnd) {
                outerElem.className = "viv-ts-space";
                if (!isAtEndOfLine()) {
                  if (textSpacing.trimEnd) {
                    outerElem.className = "viv-ts-auto";
                    if (!isAtEndOfLine()) {
                      outerElem.className = "viv-hang-end";
                    }
                  } else {
                    outerElem.className = "viv-hang-end";
                  }
                }
              } else {
                outerElem.className = "viv-ts-auto";
                if (!isAtEndOfLine()) {
                  outerElem.className = "viv-hang-end";
                }
              }
            }
          } else if (textSpacing.trimEnd) {
            if (isAtEndOfLine()) {
              if (textSpacing.allowEnd) {
                outerElem.className = "viv-ts-space";
              } else {
                outerElem.className = "viv-ts-auto";
              }
            } else {
              const linePos = linePosition();
              outerElem.className = "viv-ts-auto";
              if (linePos === linePosition()) {
                outerElem.className = "";
              }
            }
          }
        }
      }
    }

    let spaceIdeoAlnumProcessing = false;

    function checkUpright(elem: Element): boolean {
      const style = elem?.ownerDocument.defaultView?.getComputedStyle(elem);
      return (
        !!style &&
        (style.textOrientation === "upright" ||
          style.textCombineUpright === "all" ||
          style["-webkit-text-combine"] === "horizontal")
      );
    }

    function checkNonZeroMarginBorderPadding(
      node1: Node,
      node2: Node,
    ): boolean {
      if (node1.nodeType === 1) {
        const style = document.defaultView.getComputedStyle(node1 as Element);
        if (
          parseFloat(style.marginInlineEnd) ||
          parseFloat(style.borderInlineEndWidth) ||
          parseFloat(style.paddingInlineEnd)
        ) {
          return true;
        }
      }
      const parent1 = node1.parentElement;
      if (parent1 && !parent1.contains(node2)) {
        return checkNonZeroMarginBorderPadding(parent1, node2);
      }
      if (node2.nodeType === 1) {
        const style = document.defaultView.getComputedStyle(node2 as Element);
        if (
          parseFloat(style.marginInlineStart) ||
          parseFloat(style.borderInlineStartWidth) ||
          parseFloat(style.paddingInlineStart)
        ) {
          return true;
        }
      }
      const parent2 = node2.parentElement;
      if (parent2 && !parent2.contains(node1)) {
        return checkNonZeroMarginBorderPadding(node1, parent2);
      }
      return false;
    }

    if (textSpacing.ideographAlpha || textSpacing.ideographNumeric) {
      if (
        prevNode &&
        /^(?!\p{P})[\p{sc=Han}\u3041-\u30FF\u31C0-\u31FF]/u.test(text) &&
        ((textSpacing.ideographAlpha &&
          /(?![\p{sc=Han}\u3041-\u30FF\u31C0-\u31FF\uFF01-\uFF60])\p{L}\p{M}*$/u.test(
            prevNode.textContent,
          )) ||
          (textSpacing.ideographNumeric &&
            /(?![\uFF01-\uFF60])\p{Nd}\p{M}*$/u.test(prevNode.textContent))) &&
        !(vertical && checkUpright(prevNode.parentElement)) &&
        !checkNonZeroMarginBorderPadding(prevNode, textNode)
      ) {
        textNode.parentNode.insertBefore(
          document.createElement("viv-ts-thin-sp"),
          textNode,
        );
        spaceIdeoAlnumProcessing = true;
      }
      if (
        nextNode &&
        /(?!\p{P})[\p{sc=Han}\u3041-\u30FF\u31C0-\u31FF]\p{M}*$/u.test(text) &&
        ((textSpacing.ideographAlpha &&
          /^(?![\p{sc=Han}\u3041-\u30FF\u31C0-\u31FF\uFF01-\uFF60])\p{L}/u.test(
            nextNode.textContent,
          )) ||
          (textSpacing.ideographNumeric &&
            /^(?![\uFF01-\uFF60])\p{Nd}/u.test(nextNode.textContent))) &&
        !(vertical && checkUpright(nextNode.parentElement)) &&
        !checkNonZeroMarginBorderPadding(textNode, nextNode)
      ) {
        textNode.parentNode.insertBefore(
          document.createElement("viv-ts-thin-sp"),
          textNode.nextSibling,
        );
        spaceIdeoAlnumProcessing = true;
      }
    }
  }

  registerHooks() {
    Plugin.registerHook(
      Plugin.HOOKS.POLYFILLED_INHERITED_PROPS,
      this.getPolyfilledInheritedProps.bind(this),
    );
    Plugin.registerHook(
      Plugin.HOOKS.PREPROCESS_SINGLE_DOCUMENT,
      this.preprocessSingleDocument.bind(this),
    );
    Plugin.registerHook(
      Plugin.HOOKS.POST_LAYOUT_BLOCK,
      this.postLayoutBlock.bind(this),
    );
  }
}

const textPolyfill = new TextSpacingPolyfill();
textPolyfill.registerHooks();

export function preprocessForTextSpacing(element: Element): void {
  textPolyfill.preprocessForTextSpacing(element);
}

export function processGeneratedContent(
  element: HTMLElement,
  textSpacing: Css.Val,
  hangingPunctuation: Css.Val,
  lang: string,
  vertical: boolean,
): void {
  textPolyfill.processGeneratedContent(
    element,
    textSpacing,
    hangingPunctuation,
    lang,
    vertical,
  );
}
