/* eslint-disable @typescript-eslint/ban-types */
/* eslint-disable @typescript-eslint/naming-convention */
import { route } from 'futen';
import type Futen from 'futen';

export function Swagger<S extends Futen>(server: S, path = '/swagger.json'): void {
    const SwaggerRoute = route(path)(
        class {
            public get(): Response {
                const routes = Object.entries(server.routes).map(
                    ([routeClass, handler]) => {
                        return {
                            class: routeClass,
                            methods: Object.values(handler).filter((property) => {
                                if (typeof property !== 'function') return false;
                                return ['get', 'head', 'post', 'put', 'delete', 'connect', 'options', 'trace', 'patch'].includes((property as Function).name);
                            }).map((method: Function) => method.name.toLowerCase()),
                            path: handler.path
                        };
                    }
                );
                return Response.json({
                    routes
                });
            }
        }
    );
    const swagger = server.router.register(path);
    swagger[0] = SwaggerRoute as unknown as typeof swagger[0];
}
