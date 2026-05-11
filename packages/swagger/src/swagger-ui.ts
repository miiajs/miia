export function buildSwaggerInitializer(specUrl: string, swaggerOptions?: Record<string, any>): string {
  const config = JSON.stringify({
    url: specUrl,
    dom_id: '#swagger-ui',
    deepLinking: true,
    ...swaggerOptions,
  })

  return `window.onload = function() {
  var config = ${config};
  config.presets = [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset];
  config.plugins = [SwaggerUIBundle.plugins.DownloadUrl];
  config.layout = "StandaloneLayout";
  window.ui = SwaggerUIBundle(config);
};`
}
