import type { FastifyPluginAsync } from "fastify";
import { ensureCompanyByReference, ensureEmployeePrincipal } from "../core/identity";

const employeesRoutes: FastifyPluginAsync = async (app) => {
  app.post("/bootstrap", async (request) => {
    const body = request.body as {
      companyReference?: string;
      companyName?: string;
      email?: string;
      phone?: string;
      fullName?: string;
      handle?: string;
      employeeCode?: string;
    };

    const companyId = await ensureCompanyByReference(app, {
      companyReference: body.companyReference,
      companyName: body.companyName,
    });

    const employee = await ensureEmployeePrincipal(app, {
      companyId,
      email: body.email,
      phone: body.phone,
      fullName: body.fullName,
      handle: body.handle,
      employeeCode: body.employeeCode,
    });

    return {
      status: "ok",
      data: {
        companyId,
        employeeUserId: employee.userId,
        employeeCode: employee.employeeCode,
        email: employee.email,
      },
    };
  });
};

export default employeesRoutes;
