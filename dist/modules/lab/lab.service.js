"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createLab = createLab;
function createLab(name) {
    return {
        id: crypto.randomUUID(),
        name,
    };
}
//# sourceMappingURL=lab.service.js.map