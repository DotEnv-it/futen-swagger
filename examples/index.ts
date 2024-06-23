import { Swagger } from '../dist/index.mjs';
import Futen, { route } from 'futen';

@route('/')
class Home {
    public get(): Response {
        return new Response('Hello, World!');
    }
}

@route('/dynamic/:id/:adding/SomeText?query=value&query2?=value2')
class DynamicRoute {
    public get(_request: Request, params: {
        id: string;
        adding: string;
    }): Response {
        console.log(params);
        return new Response('Dynamic Route');
    }
}

const WrappedRoute = route('/wrapped')(
    class {
        public get(): Response {
            return new Response('Wrapped Route');
        }
    }
);

const server = new Futen(
    {
        Home,
        DynamicRoute,
        WrappedRoute
    },
    {
        port: 3000
    }
).plug(Swagger);

console.log(`Server on http://localhost:${server.instance.port}/swagger`);
