import { Swagger } from '../dist/index.mjs';
import Futen, { route } from 'futen';
import { describe, test, expect } from 'bun:test';
import { docs } from '../src';
import { OpenAPIV3 } from 'openapi-types';

describe('PLUGINS', () => {
    @route('/')
    class Home {
        public get(): Response {
            const routes = Object.entries(server.routes).map(
                ([routeClass, handler]) => {
                    return {
                        class: routeClass,
                        path: handler.path
                    };
                }
            );
            return Response.json({
                routes
            });
        }
    }

    @route('/test')
    class Test {
        @docs({
            requestBody: {
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: {
                                hello: {
                                    type: 'string'
                                }
                            }
                        }
                    }
                }
            },
            responses: {
                200: {
                    description: 'OK'
                }
            }
        })
        public async post(request: Request): Promise<Response> {
            return Response.json({ object: await request.json() });
        }
    }

    const server = new Futen(
        {
            Home,
            Test
        },
        {
            port: 0
        }
    )
        .plug(Swagger)

    const { port } = server.instance;
    test('should return routes', async () => {
        const response = await fetch(
            new Request(`http://localhost:${port}/`)
        );
        const body = await response.json();
        expect(body).toEqual({
            routes: [
                {
                    class: 'Home',
                    path: '/'
                },
                {
                    class: 'Test',
                    path: '/test'
                }
            ]
        });
    });

    test('should return request body', async () => {
        const response = await fetch(
            new Request(`http://localhost:${port}/test`, {
                method: 'post',
                body: JSON.stringify({ hello: 'world' })
            })
        );
        const body = await response.json();
        expect(body).toEqual({ object: { hello: 'world' } });
    });

    test('should return swagger.json', async () => {
        const response = await fetch(
            new Request(`http://localhost:${port}/swagger.json`)
        );
        const body = await response.json();
        expect(body).toEqual({
            openapi: "3.0.0",
            info: {
                title: "Futen API",
                description: "Futen API Documentation",
                version: "0.0.0",
            },
            paths: {
                "/": {
                    get: {
                        responses: {
                            "200": {
                                content: {
                                    "application/json": {
                                        schema: {
                                            properties: {
                                                routes: {
                                                    items: {
                                                        properties: {
                                                            class: {
                                                                example: "string",
                                                                type: "string",
                                                            },
                                                            path: {
                                                                example: "string",
                                                                type: "string",
                                                            },
                                                        },
                                                        type: "object",
                                                    },
                                                    type: "array",
                                                },
                                            },
                                            type: "object",
                                        },
                                    },
                                },
                                description: "OK",
                            },
                        },
                        parameters: [],
                        tags: ["Home"],
                    }
                },
                "/test": {
                    post: {
                        parameters: [],
                        requestBody: {
                            content: {
                                "application/json": {
                                    schema: {
                                        properties: {
                                            hello: {
                                                type: "string",
                                            },
                                        },
                                        type: "object",
                                    },
                                },
                            },
                        },
                        responses: {
                            "200": {
                                description: "OK",
                            },
                        },
                        tags: ["Test"],
                    },
                },
            },
        } satisfies OpenAPIV3.Document);
    });
});
