import swaggerUi from 'swagger-ui-express';
import {Router} from 'express';
import {buildOpenApiDocument} from '../docs/openapi';

const document = buildOpenApiDocument();
const swaggerRouter = Router();

swaggerRouter.get('/api-docs/openapi.json', (_req, res) => {
    res.json(document);
});
swaggerRouter.use('/api-docs', swaggerUi.serve, swaggerUi.setup(document));

export default swaggerRouter;
