import { Swagger } from '../src/index.ts';
import { getCompiledFunctionsReturnTypes } from '../src/util/ts-compiler-api';
import { something } from './importer.ts';
import { inspect } from 'bun';
import Futen, { route } from 'futen';

@route('/')
class Home {
    public get(): Response {
        const rand = Math.random();
        if (rand > 0.5)
            return new Response('Hello, World!');
        if (rand > 0.25)
            return new Response('Hello, World!', { status: 201 });
        return Response.json({ message: 'Hello, World!', random: rand, nested: { key: 'value', num: 32 } });
    }

    public post(): Response {
        return new Response('Hello, World!');
    }

    public put(): Response {
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
        return new Response(Bun.file('Dynamic Route'));
    }

    public post(_request: Request, params: {
        id: string;
        adding: string;
    }): Response {
        console.log(params);
        return new Response(Bun.file('Dynamic Route'));
    }
}

const WrappedRoute = route('/wrapped')(
    class {
        public get(): Response {
            const file = new Blob(['Wrapped Route'], { type: 'text/plain' });
            return new Response(file);
        }

        public post(): Response {
            return new Response('Wrapped Route');
        }

        public put(): Response {
            return new Response([]);
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

function exampleFunction(): Response {
    const rand = Math.random();
    if (rand > 0.5)
        return new Response('Hello, World!');
    if (rand > 0.25)
        return new Response('Hello, World!', { status: 200 });
    return Response.json({ message: 'Hello, World!', random: rand, nested: { key: 'value', num: 32 } });
}

// eslint-disable-next-line func-style
const arrowFunction = (): Response => {
    const rand = Math.random();
    if (rand > 0.5)
        return new Response('Hello, World!');
    if (rand > 0.25)
        return new Response('Hello, World!', { status: 200 });
    return Response.json({ message: 'Hello, World!', random: Math.random(), nested: { key: 'value', num: 32 } });
};

function blobReturningFunction(): Response {
    return new Response(new Blob(['Hello, World!'], { type: 'text/plain' }));
}

function returnsAComputedTypeInABlob(): Response {
    const obj = { message: 'Hello, World!', random: Math.random(), nested: { key: 'value', num: 32 } };
    return new Response(new Blob([JSON.stringify(obj)], { type: 'application/json' }));
}

function usesImportedVariable(): Response {
    const typer = something;
    return new Response(new Blob([JSON.stringify(typer)], { type: 'application/json' }));
}

console.log(inspect(getCompiledFunctionsReturnTypes({
    // eslint-disable-next-line @typescript-eslint/unbound-method
    Home: [server.routes.Home.target.prototype.get, server.routes.Home.target.prototype.post],
    // eslint-disable-next-line @typescript-eslint/unbound-method
    DynamicRoute: server.routes.DynamicRoute.target.prototype.get,
    // eslint-disable-next-line @typescript-eslint/unbound-method
    WrappedRoute: server.routes.WrappedRoute.target.prototype.get,
    exampleFunction,
    arrowFunction,
    blobReturningFunction,
    returnsAComputedTypeInABlob,
    usesImportedVariable
}), { colors: true, depth: 100 }));

// server.instance.stop();
// process.exit(0);
