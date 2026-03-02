"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const lab_schema_1 = require("./lab.schema");
const lab_service_1 = require("./lab.service");
const labRoutes = async (app) => {
    app.post("/labs", {
        schema: lab_schema_1.labCreateSchema,
    }, async (request) => {
        const body = request.body;
        return (0, lab_service_1.createLab)(body.name);
    });
};
exports.default = labRoutes;
//# sourceMappingURL=lab.routes.js.map