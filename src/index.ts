/* eslint-disable @typescript-eslint/ban-types */
/* eslint-disable @typescript-eslint/naming-convention */
import { SwaggerUI } from './themes/swagger-ui';
import { route } from 'futen';
import type { OpenAPIV3 } from 'openapi-types';
import type Futen from 'futen';

type HTTPMethods = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS' | 'CONNECT' | 'TRACE';
type PathsAccumulator = Record<string, Record<string, OpenAPIV3.OperationObject>>;
type SwaggerConfig = {
    version?: string;
    theme?: string;
    path?: string;
};

export function docs(routeApiDocs: OpenAPIV3.OperationObject) {
    return function <T, M>(
        target: T & { data?: Record<string, OpenAPIV3.OperationObject> },
        key: M,
        descriptor?: PropertyDescriptor
    ) {
        if (!target.data) target.data = {};
        target.data[key as Lowercase<HTTPMethods>] = routeApiDocs;
        if (descriptor)
            return descriptor.value;
    };
}

function generateSwaggerJSON(routes: Futen['routes']): OpenAPIV3.Document {
    const routesObject = Object.entries(routes).map(([routeClassName, handler]) => {
        return {
            routeClassName,
            methods: Object.values(handler).filter((property) => {
                if (typeof property !== 'function') return false;
                return ['get', 'head', 'post', 'put', 'delete', 'connect', 'options', 'trace', 'patch'].includes((property as Function).name);
            }).map((method: Function) => method.name.toLowerCase()),
            path: handler.path
        };
    });

    const paths = routesObject.reduce<PathsAccumulator>((acc, { routeClassName, methods, path }) => {
        const routeData = routes[routeClassName].data;
        const routeParams = path.match(/:[a-zA-Z0-9]+/g);
        const pathParams = routeParams?.reduce((pathAcc, param) => {
            return {
                ...pathAcc,
                [param.slice(1)]: {
                    name: param.slice(1),
                    in: 'path',
                    required: !param.endsWith('?'),
                    schema: {
                        type: 'string'
                    }
                }
            };
        }, {}) ?? {};

        const queryParam = path.match(/(?:\?|&)[\w]+\??/g);
        const queryParams = queryParam?.reduce((queryAcc, param) => {
            param = param.slice(1);
            return {
                ...queryAcc,
                [param.endsWith('?') ? param.slice(0, -1) : param]: {
                    name: param.endsWith('?') ? param.slice(0, -1) : param,
                    in: 'query',
                    required: !param.endsWith('?'),
                    schema: {
                        type: 'string'
                    }
                }
            };
        }, {}) ?? {};

        methods.forEach((method) => {
            const routeMethodData = routeData?.[method] as OpenAPIV3.OperationObject | undefined;
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            if (acc[path] === undefined) acc[path] = {};

            acc[path][method] = {
                parameters: [
                    ...Object.values(pathParams),
                    ...Object.values(queryParams)
                ] as OpenAPIV3.ParameterObject[],
                responses: routeMethodData?.responses ?? {},
                ...routeMethodData
            } satisfies OpenAPIV3.PathItemObject;
        });

        return acc;
    }, {});

    const formattedPaths = Object.keys(paths).reduce<PathsAccumulator>((acc, path) => {
        const { 0: formattedPath } = path.replace(/:(\w+)/g, '{$1}').split('?');
        acc[formattedPath] = paths[path];
        return acc;
    }, {});

    return {
        openapi: '3.0.0',
        info: {
            title: 'Futen API',
            description: 'Futen API Documentation',
            version: '0.0.0'
        },
        paths: formattedPaths
    };
}

export function Swagger<S extends Futen>(server: S, config?: SwaggerConfig): void {
    const {
        version = '5.9.0',
        theme = `https://unpkg.com/swagger-ui-dist@${version}/swagger-ui.css`,
        path = '/swagger'
    }: SwaggerConfig = config ?? {};

    const relativePath = path.startsWith('/') ? path.slice(1) : path;

    const SwaggerJSONRoute = route(`${path}.json`)(
        class {
            public get(): Response {
                return Response.json(
                    generateSwaggerJSON(server.routes),
                    {
                        headers: {
                            'Content-Type': 'application/json; charset=utf-8'
                        }
                    }
                );
            }
        }
    );
    const swaggerJSON = server.router.register(`${path}.json`);
    swaggerJSON[0] = SwaggerJSONRoute as unknown as typeof swaggerJSON[0];

    const SwaggerRoute = route(path)(
        class {
            public get(): Response {
                return new Response(
                    SwaggerUI({
                        title: 'Futen API',
                        description: 'Futen API Documentation',
                        version: '0.0.0'
                    }, '5.9.0', theme, JSON.stringify({
                        url: `${relativePath}.json`,
                        dom_id: '#swagger-ui'
                    })),
                    {
                        headers: {
                            'Content-Type': 'text/html; charset=utf-8'
                        }
                    }
                );
            }
        }
    );
    const swagger = server.router.register(path);
    swagger[0] = SwaggerRoute as unknown as typeof swagger[0];
}
