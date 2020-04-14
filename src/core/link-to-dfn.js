// @ts-check
// Module core/link-to-dfn
// Gives definitions in definitionMap IDs and links <a> tags
// to the matching definitions.
import {
  CaseInsensitiveMap,
  addId,
  getIntlData,
  getLinkTargets,
  showInlineError,
  showInlineWarning,
  wrapInner,
} from "./utils.js";
import { THIS_SPEC, toCiteDetails } from "./data-cite.js";
import { definitionMap } from "./dfn-map.js";

export const name = "core/link-to-dfn";

/** @type {HTMLElement[]} */
export const possibleExternalLinks = [];

const localizationStrings = {
  en: {
    /**
     * @param {string} title
     */
    duplicateMsg(title) {
      return `Duplicate definition(s) of '${title}'`;
    },
    duplicateTitle: "This is defined more than once in the document.",
  },
  ja: {
    /**
     * @param {string} title
     */
    duplicateMsg(title) {
      return `'${title}' の重複定義`;
    },
    duplicateTitle: "この文書内で複数回定義されています．",
  },
  de: {
    /**
     * @param {string} title
     */
    duplicateMsg(title) {
      return `Mehrfache Definition von '${title}'`;
    },
    duplicateTitle:
      "Das Dokument enthält mehrere Definitionen dieses Eintrags.",
  },
};
const l10n = getIntlData(localizationStrings);

export async function run(conf) {
  const titleToDfns = mapTitleToDfns();
  /** @type {HTMLAnchorElement[]} */
  const badLinks = [];

  const localLinkSelector =
    "a[data-cite=''], a:not([href]):not([data-cite]):not(.logo):not(.externalDFN)";
  document.querySelectorAll(localLinkSelector).forEach((
    /** @type {HTMLAnchorElement} */ anchor
  ) => {
    const linkTargets = getLinkTargets(anchor);
    const foundDfn = linkTargets.some(target => {
      return findLinkTarget(target, anchor, titleToDfns);
    });
    if (!foundDfn && linkTargets.length !== 0) {
      if (anchor.dataset.cite === "") {
        badLinks.push(anchor);
      } else {
        possibleExternalLinks.push(anchor);
      }
    }
  });

  showLinkingError(badLinks);

  // This needs to run before core/xref adds its data-cite and updates
  // conf.normativeReferences and conf.informativeReferences.
  updateReferences(conf);

  if (!conf.xref) {
    showLinkingError(possibleExternalLinks);
  }
}

function mapTitleToDfns() {
  const titleToDfns = new CaseInsensitiveMap();
  for (const key of definitionMap.keys()) {
    const { result, duplicates } = collectDfns(key);
    titleToDfns.set(key, result);
    if (duplicates.length > 0) {
      showInlineError(duplicates, l10n.duplicateMsg(key), l10n.duplicateTitle);
    }
  }
  return titleToDfns;
}

/**
 * @param {string} title
 */
function collectDfns(title) {
  /** @type {Map<string, Map<string, HTMLElement>>} */
  const result = new Map();
  const duplicates = [];
  for (const dfn of definitionMap.get(title)) {
    const { dfnFor = "", dfnType = "dfn" } = dfn.dataset;
    if (result.has(dfnFor) && result.get(dfnFor).has(dfnType)) {
      const oldDfn = result.get(dfnFor).get(dfnType);
      const oldIsDfn = oldDfn.localName === "dfn";
      const newIsDfn = dfn.localName === "dfn";
      const isSameDfnType = dfnType === oldDfn.dataset.dfnType;
      if (oldIsDfn) {
        if (!newIsDfn || !isSameDfnType) {
          // Don't overwrite <dfn> definitions.
          continue;
        }
        duplicates.push(dfn);
      }
    }
    const type = "idl" in dfn.dataset || dfnType !== "dfn" ? "idl" : "dfn";
    if (!result.has(dfnFor)) {
      result.set(dfnFor, new Map([[type, dfn]]));
    } else {
      result.get(dfnFor).set(type, dfn);
    }
    addId(dfn, "dfn", title);
  }

  return { result, duplicates };
}

/**
 * @param {import("./utils.js").LinkTarget} target
 * @param {HTMLAnchorElement} anchor
 * @param {CaseInsensitiveMap} titleToDfns
 */
function findLinkTarget(target, anchor, titleToDfns) {
  const { linkFor, linkType = "" } = anchor.dataset;
  if (
    !titleToDfns.has(target.title) ||
    !titleToDfns.get(target.title).get(target.for)
  ) {
    return false;
  }
  const dfnFors = titleToDfns.get(target.title).get(target.for);

  let dfn;

  // we are going to have to guess, assume is it's for something, it's more likely IDL.
  if (!linkType) {
    dfn = dfnFors.get(target.for === "" ? "dfn" : "idl") || dfnFors.get("idl");
  } else {
    dfn = dfnFors.get(linkType === "dfn" ? "dfn" : "idl");
  }

  if (dfn.dataset.cite) {
    anchor.dataset.cite = dfn.dataset.cite;
  } else if (linkFor && !titleToDfns.get(linkFor)) {
    possibleExternalLinks.push(anchor);
  } else if (dfn.classList.contains("externalDFN")) {
    // data-lt[0] serves as unique id for the dfn which this element references
    const lt = dfn.dataset.lt ? dfn.dataset.lt.split("|") : [];
    anchor.dataset.lt = lt[0] || dfn.textContent;
    possibleExternalLinks.push(anchor);
  } else {
    if (anchor.dataset.idl === "partial") {
      possibleExternalLinks.push(anchor);
    } else {
      anchor.href = `#${dfn.id}`;
      anchor.classList.add("internalDFN");
    }
  }
  if (!anchor.hasAttribute("data-link-type")) {
    anchor.dataset.linkType = "idl" in dfn.dataset ? "idl" : "dfn";
  }
  if (isCode(dfn)) {
    wrapAsCode(anchor, dfn);
  }
  return true;
}

/**
 * Check if a definition is a code
 * @param {HTMLElement} dfn a definition
 */
function isCode(dfn) {
  if ("idl" in dfn.dataset || dfn.closest("code,pre")) {
    return true;
  }
  // Note that childNodes.length === 1 excludes
  // definitions that have either other text, or other
  // whitespace, inside the <dfn>.
  if (dfn.childNodes.length !== 1) {
    return false;
  }
  const [first] = /** @type {NodeListOf<HTMLElement>} */ (dfn.childNodes);
  return first.localName === "code";
}

/**
 * Wrap links by <code>.
 * @param {HTMLAnchorElement} anchor a link
 * @param {HTMLElement} dfn a definition
 */
function wrapAsCode(anchor, dfn) {
  // only add code to IDL when the definition matches
  const term = anchor.textContent.trim();
  const isIDL = dfn.dataset.hasOwnProperty("idl");
  const needsCode = shouldWrapByCode(anchor) || shouldWrapByCode(dfn, term);
  if (!isIDL || needsCode) {
    wrapInner(anchor, document.createElement("code"));
  }
}

/**
 * @param {HTMLElement} elem
 * @param {string} term
 */
function shouldWrapByCode(elem, term = "") {
  switch (elem.localName) {
    case "a":
      if (elem.querySelector("code")) {
        return true;
      }
      break;
    default: {
      const { dataset } = elem;
      if (elem.textContent.trim() === term) {
        return true;
      } else if (dataset.title === term) {
        return true;
      } else if (dataset.lt || dataset.localLt) {
        const terms = [];
        if (dataset.lt) {
          terms.push(...dataset.lt.split("|"));
        }
        if (dataset.localLt) {
          terms.push(...dataset.localLt.split("|"));
        }
        return terms.includes(term);
      }
    }
  }
  return false;
}

function showLinkingError(elems) {
  elems.forEach(elem => {
    showInlineWarning(
      elem,
      `Found linkless \`<a>\` element with text "${elem.textContent}" but no matching \`<dfn>\``,
      "Linking error: not matching `<dfn>`"
    );
  });
}

/**
 * Update references due to `data-cite` attributes.
 *
 * Also, make sure self-citing doesn't cause current document getting added to
 * bibliographic references section.
 * @param {Conf} conf
 */
function updateReferences(conf) {
  const shortName = new RegExp(
    String.raw`\b${(conf.shortName || "").toLowerCase()}\b`,
    "i"
  );

  /** @type {NodeListOf<HTMLElement>} */
  const elems = document.querySelectorAll(
    "dfn[data-cite]:not([data-cite='']), a[data-cite]:not([data-cite=''])"
  );
  for (const elem of elems) {
    elem.dataset.cite = elem.dataset.cite.replace(shortName, THIS_SPEC);
    const { key, isNormative } = toCiteDetails(elem);
    if (key === THIS_SPEC) continue;

    if (!isNormative && !conf.normativeReferences.has(key)) {
      conf.informativeReferences.add(key);
    } else {
      conf.normativeReferences.add(key);
      conf.informativeReferences.delete(key);
    }
  }
}
