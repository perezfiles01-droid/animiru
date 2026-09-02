/**
 * Common helpers for Animiru JavaScript extensions.
 *
 * These helpers are intentionally dependency-free so individual sources can
 * use them without changing the extension runtime.
 */

/**
 * Return a clean string.
 */
function sourceString(value, fallback) {
  if (value === undefined || value === null) {
    return fallback || "";
  }

  return String(value).trim();
}

/**
 * Check whether a value is a valid HTTP/HTTPS URL.
 */
function sourceIsUrl(value) {
  var url = sourceString(value);

  if (!url) return false;

  try {
    var parsed = new URL(url);

    return (
      parsed.protocol === "http:" ||
      parsed.protocol === "https:"
    );
  } catch (e) {
    return false;
  }
}

/**
 * Convert a relative URL into an absolute URL.
 */
function sourceAbsoluteUrl(baseUrl, value) {
  var target = sourceString(value);
  var base = sourceString(baseUrl);

  if (!target) return "";

  if (/^https?:\/\//i.test(target)) {
    return target;
  }

  if (target.indexOf("//") === 0) {
    return "https:" + target;
  }

  if (!base) return target;

  try {
    return new URL(target, base).toString();
  } catch (e) {
    if (target.charAt(0) === "/") {
      return base.replace(/\/+$/, "") + target;
    }

    return base.replace(/\/+$/, "") + "/" + target;
  }
}

/**
 * Remove duplicate anime results.
 */
function sourceUniqueItems(items) {
  if (!Array.isArray(items)) return [];

  var result = [];
  var seen = {};

  for (var i = 0; i < items.length; i++) {
    var item = items[i];

    if (!item || typeof item !== "object") {
      continue;
    }

    var key = sourceString(item.link || item.url || item.name);

    if (!key) continue;

    key = key.toLowerCase();

    if (seen[key]) continue;

    seen[key] = true;
    result.push(item);
  }

  return result;
}

/**
 * Validate one anime card.
 */
function sourceValidateAnimeItem(item, baseUrl) {
  if (!item || typeof item !== "object") {
    return {
      valid: false,
      reason: "Anime result is not an object"
    };
  }

  var name = sourceString(item.name);
  var link = sourceAbsoluteUrl(baseUrl, item.link);

  if (!name) {
    return {
      valid: false,
      reason: "Anime result has no name"
    };
  }

  if (!link || !sourceIsUrl(link)) {
    return {
      valid: false,
      reason: "Anime result has an invalid link"
    };
  }

  return {
    valid: true,
    item: {
      name: name,
      link: link,
      imageUrl: sourceAbsoluteUrl(baseUrl, item.imageUrl || "")
    }
  };
}

/**
 * Validate and clean a list of anime results.
 */
function sourceValidateAnimeList(items, baseUrl) {
  if (!Array.isArray(items)) {
    return {
      valid: false,
      list: [],
      errors: ["Provider did not return an array"]
    };
  }

  var valid = [];
  var errors = [];

  for (var i = 0; i < items.length; i++) {
    var checked = sourceValidateAnimeItem(items[i], baseUrl);

    if (checked.valid) {
      valid.push(checked.item);
    } else {
      errors.push("Item " + i + ": " + checked.reason);
    }
  }

  return {
    valid: errors.length === 0,
    list: sourceUniqueItems(valid),
    errors: errors
  };
}

/**
 * Validate an episode/chapter.
 */
function sourceValidateEpisode(item, baseUrl) {
  if (!item || typeof item !== "object") {
    return {
      valid: false,
      reason: "Episode is not an object"
    };
  }

  var name = sourceString(item.name);
  var url = sourceAbsoluteUrl(
    baseUrl,
    item.url || item.link
  );

  if (!name) {
    return {
      valid: false,
      reason: "Episode has no name"
    };
  }

  if (!url || !sourceIsUrl(url)) {
    return {
      valid: false,
      reason: "Episode has an invalid URL"
    };
  }

  return {
    valid: true,
    item: {
      name: name,
      url: url,
      isFiller: item.isFiller === true
    }
  };
}

/**
 * Validate a list of episodes.
 */
function sourceValidateEpisodes(items, baseUrl) {
  if (!Array.isArray(items)) {
    return {
      valid: false,
      chapters: [],
      errors: ["Provider did not return an episode array"]
    };
  }

  var chapters = [];
  var errors = [];

  for (var i = 0; i < items.length; i++) {
    var checked = sourceValidateEpisode(items[i], baseUrl);

    if (checked.valid) {
      chapters.push(checked.item);
    } else {
      errors.push("Episode " + i + ": " + checked.reason);
    }
  }

  return {
    valid: errors.length === 0,
    chapters: sourceUniqueItems(chapters),
    errors: errors
  };
}

/**
 * Validate anime details.
 */
function sourceValidateDetail(detail, baseUrl) {
  if (!detail || typeof detail !== "object") {
    return {
      valid: false,
      errors: ["Detail result is not an object"]
    };
  }

  var errors = [];

  if (!sourceString(detail.name)) {
    errors.push("Detail has no name");
  }

  if (detail.link && !sourceIsUrl(sourceAbsoluteUrl(baseUrl, detail.link))) {
    errors.push("Detail has an invalid link");
  }

  if (!Array.isArray(detail.genre)) {
    errors.push("Detail genre is not an array");
  }

  if (!Array.isArray(detail.chapters)) {
    errors.push("Detail chapters is not an array");
  }

  return {
    valid: errors.length === 0,
    errors: errors
  };
}

/**
 * Validate a video/source result.
 */
function sourceValidateVideo(item) {
  if (!item || typeof item !== "object") {
    return {
      valid: false,
      reason: "Video result is not an object"
    };
  }

  var url = sourceString(item.url || item.file);

  if (!url || !sourceIsUrl(url)) {
    return {
      valid: false,
      reason: "Video result has no valid URL"
    };
  }

  return {
    valid: true,
    item: item
  };
}

/**
 * Validate a list of video results.
 */
function sourceValidateVideos(items) {
  if (!Array.isArray(items)) {
    return {
      valid: false,
      list: [],
      errors: ["Provider did not return a video array"]
    };
  }

  var list = [];
  var errors = [];

  for (var i = 0; i < items.length; i++) {
    var checked = sourceValidateVideo(items[i]);

    if (checked.valid) {
      list.push(checked.item);
    } else {
      errors.push("Video " + i + ": " + checked.reason);
    }
  }

  return {
    valid: errors.length === 0,
    list: list,
    errors: errors
  };
}

/**
 * Create useful diagnostics for an empty provider result.
 */
function sourceEmptyDiagnostics(method, query, requests) {
  return {
    type: "EMPTY_RESULT",
    method: sourceString(method, "unknown"),
    query: sourceString(query),
    requestCount: Array.isArray(requests)
      ? requests.length
      : 0,
    message:
      "The extension completed successfully but returned no usable results.",
    suggestions: [
      "Check the source URL or API endpoint.",
      "Check whether the site's response format changed.",
      "Check the extension parser or selector.",
      "Check the recorded requests and response status."
    ]
  };
}

/**
 * Build a consistent paginated result.
 */
function sourcePage(list, hasNextPage) {
  var clean = Array.isArray(list) ? list : [];

  return {
    list: clean,
    hasNextPage: hasNextPage === true
  };
}

/**
 * Expose the helpers.
 *
 * The Node backend can require this file.
 */
if (typeof module !== "undefined") {
  module.exports = {
    sourceString,
    sourceIsUrl,
    sourceAbsoluteUrl,
    sourceUniqueItems,
    sourceValidateAnimeItem,
    sourceValidateAnimeList,
    sourceValidateEpisode,
    sourceValidateEpisodes,
    sourceValidateDetail,
    sourceValidateVideo,
    sourceValidateVideos,
    sourceEmptyDiagnostics,
    sourcePage
  };
}
