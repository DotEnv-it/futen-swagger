import type { OpenAPIV3 } from 'openapi-types';

// eslint-disable-next-line @typescript-eslint/naming-convention
export function SwaggerUI(
    info: OpenAPIV3.InfoObject,
    version: string,
    theme: string,
    stringifiedSwaggerOptions: string
): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${info.title}</title>
    <meta
        name="description"
        content="${info.description}"
    />
    <meta
        name="og:description"
        content="${info.description}"
    />
    <link rel="stylesheet" href="${theme}" />
</head>
<body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@${version}/swagger-ui-bundle.js" crossorigin></script>
    <script>
        window.onload = () => {
            window.ui = SwaggerUIBundle(${stringifiedSwaggerOptions});
        };
    </script>
</body>
</html>`;
}
