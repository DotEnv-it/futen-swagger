/* eslint-disable @typescript-eslint/naming-convention */
import { Swagger, docs } from '../dist/index.mjs';
import Futen, { route } from 'futen';

@route('/')
class Home {
    @docs({
        responses: {
            200: {
                description: 'Hello, World!'
            }
        }
    })
    public get(): Response {
        return new Response('Hello, World!');
    }
}

const server = new Futen(
    {
        Home
    },
    {
        port: 3000
    }
).plug(Swagger);

console.log(`Server on http://localhost:${server.instance.port}/swagger`);
