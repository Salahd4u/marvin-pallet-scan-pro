const { getDefaultConfig } = require("expo/metro-config");
const { withRorkMetro } = require("@rork-ai/toolkit-sdk/metro");

const config = getDefaultConfig(__dirname);

// Support .html assets for the detection processor WebView
config.resolver.assetExts = config.resolver.assetExts ?? [];
if (!config.resolver.assetExts.includes("html")) {
  config.resolver.assetExts.push("html");
}

module.exports = withRorkMetro(config);
