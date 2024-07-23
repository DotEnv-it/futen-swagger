/* eslint-disable @typescript-eslint/ban-types */
/* eslint-disable @typescript-eslint/naming-convention */
import { SwaggerUI } from './themes/swagger-ui';
import { getCompiledFunctionsReturnTypes } from './util/ts-compiler-api';
import { route } from 'futen';
// import { inspect } from 'util';
import type { BlobOptions } from 'buffer';
import type { Properties, Property, ReturnTypeObject } from './util/ts-compiler-api';
import type { OpenAPIV3 } from 'openapi-types';
import type Futen from 'futen';
import type { BinaryLike } from 'crypto';

type HTTPMethods = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS' | 'CONNECT' | 'TRACE';
type PathsAccumulator = Record<string, Record<string, OpenAPIV3.OperationObject>>;
type SwaggerConfig = {
    title?: string;
    description?: string;
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

function isReturnTypeObject(input: Property): input is ReturnTypeObject {
    if (input === undefined) return false;
    if (typeof input === 'string') return false;
    else if (typeof input === 'number') return false;
    else if (typeof input === 'boolean') return false;
    return Object.hasOwn(input, 'returnType') && Object.hasOwn(input, 'properties');
}

function isResponse(returnType: string, properties: Record<string, any> | Properties): properties is [Properties, ResponseInit | undefined] {
    return returnType === 'Response' && properties.length > 0;
}

function convertPropertiesToSchema(property: Property): OpenAPIV3.SchemaObject | undefined {
    if (property === undefined) return undefined;

    if (isReturnTypeObject(property)) {
        const { properties, returnType } = property;
        if (returnType === 'Blob' || returnType === 'BunFile') {
            if (properties.length === 0) return { type: 'string', format: 'binary' };
            const [contents] = properties as [Array<ArrayBuffer | BinaryLike | Blob>, BlobOptions];
            if (contents.length === 0) return { type: 'string', format: 'binary' };
            return {
                type: 'string',
                format: 'binary',
                example: contents
            };
        }
        if (Array.isArray(properties)) {
            if (properties.length === 0) {
                return {
                    type: property.returnType.toLowerCase() as Exclude<OpenAPIV3.SchemaObject['type'], 'array'>
                };
            }
            return {
                type: 'array',
                items: {
                    type: 'object',
                    properties: Object.entries(properties).reduce((acc, [, value]) => {
                        return { ...acc, ...convertPropertiesToSchema(value)?.properties };
                    }, {})
                }
            };
        }
        return { type: 'object' };
    }
    if (typeof property === 'string') return { type: 'string' };
    if (typeof property === 'number') return { type: 'number' };
    if (typeof property === 'boolean') return { type: 'boolean' };
    if (property instanceof Date) return { type: 'string', format: 'date-time' };
    if (property instanceof RegExp) return { type: 'string', format: 'regex' };
    if (Array.isArray(property)) {
        if (property.length) {
            return {
                type: 'array',
                items: {
                    type: 'object',
                    properties: Object.entries(property).reduce((acc, [, value]) => {
                        return { ...acc, ...convertPropertiesToSchema(value as Property)?.properties };
                    }, {})
                }
            };
        } return { type: 'array', items: {} };
    }
    return {
        type: 'object',
        properties: Object.entries(property).reduce((acc, [key, value]) => {
            return { ...acc, [key]: convertPropertiesToSchema(value as object) };
        }, {})
    };
}

function determineContentType(returnObject: Properties): string {
    if (!isReturnTypeObject(returnObject)) {
        if (typeof returnObject === 'string') return 'text/plain';
        return 'application/json';
    }
    const { returnType, properties } = returnObject;
    if (isResponse(returnType, properties)) {
        const [, responseInit] = properties;
        const contentType = Object.entries(responseInit?.headers ?? {}).find(([key]) => key.toLowerCase() === 'content-type');
        if (contentType) return contentType[1];
    } else if (returnType === 'Blob' || returnType === 'BunFile') {
        if (properties.length > 1) {
            const [, blobInit] = properties as [Array<ArrayBuffer | BinaryLike | Blob>, BlobOptions];
            const contentType = Object.entries(blobInit).find(([key]) => key.toLowerCase() === 'type');
            if (contentType) return contentType[1];
        } else return 'application/octet-stream';
    }
    return 'application/json';
}

function convertToResponseObject(input: Properties): OpenAPIV3.ResponsesObject {
    const responses: OpenAPIV3.ResponsesObject = {};
    input.forEach((value) => {
        if (isReturnTypeObject(value)) {
            if (isResponse(value.returnType, value.properties)) {
                const [properties, responseInit] = value.properties;
                const status = responseInit?.status ?? 200;
                const description = responseInit?.statusText ?? 'OK';
                const contentType = determineContentType(properties);
                responses[status] = {
                    description,
                    content: {
                        [contentType]: {
                            schema: convertPropertiesToSchema(properties)
                        }
                    }
                };
            }
        }
    });
    return responses;
}

function generateSwaggerJSON(routes: Futen['routes']): OpenAPIV3.Document {
    const routesObject = Object.entries(routes).map(([routeClassName, handler]) => {
        return {
            routeClassName,
            methods: Object.values(handler).filter((property: Function) => {
                if (typeof property !== 'function') return false;
                return ['get', 'head', 'post', 'put', 'delete', 'connect', 'options', 'trace', 'patch'].includes(property.name);
            }).map((method: Function) => { return { name: method.name.toLowerCase(), handler: method }; }),
            path: handler.path
        };
    });

    const compiledFunctionObjects: Record<string, Function[] | undefined> = {};
    routesObject.forEach(({ routeClassName, methods }) => {
        if (!compiledFunctionObjects[routeClassName]) {
            compiledFunctionObjects[routeClassName] = methods.map(({ handler }) => {
                return handler;
            });
        } else throw new Error(`Duplicate route class name: ${routeClassName}`);
    });
    const compiledFunctionsReturnTypes = getCompiledFunctionsReturnTypes(compiledFunctionObjects as Record<string, Function[]>);

    const paths = routesObject.reduce<PathsAccumulator>((acc, { routeClassName, methods, path }) => {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (acc[path] === undefined) acc[path] = {};
        const routeParams = path.match(/:[a-zA-Z0-9]+/g);
        const pathParams: Record<string, OpenAPIV3.ParameterObject> = routeParams?.reduce((pathAcc, param) => {
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
        const queryParams: Record<string, OpenAPIV3.ParameterObject> = queryParam?.reduce((queryAcc, param) => {
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

        const routeData = routes[routeClassName].data as Record<string, OpenAPIV3.OperationObject> | undefined;
        methods.forEach((method) => {
            const routeMethodData = routeData?.[method.name];
            const methodReturnType = compiledFunctionsReturnTypes[`${routeClassName}_${method.name}`];
            acc[path][method.name] = {
                tags: [routeClassName, ...routeMethodData?.tags ?? []],
                parameters: [
                    ...Object.values(pathParams),
                    ...Object.values(queryParams)
                ],
                responses: routeMethodData?.responses ?? convertToResponseObject(methodReturnType),
                ...routeMethodData
            } satisfies OpenAPIV3.OperationObject;
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
        title = 'Futen API',
        description = 'Futen API Documentation',
        version = '0.0.0',
        theme = 'https://unpkg.com/swagger-ui-dist@5.9.0/swagger-ui.css',
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
                        title,
                        description,
                        version
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
