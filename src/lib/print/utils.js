export const generateOptionalsHtml = (optionals, optionalGroups) => {
    let html = '';
    if (!optionals || typeof optionals !== 'object' || Object.keys(optionals).length === 0) {
        return '';
    }

    html += '<div class="optionals-container">';
    Object.entries(optionals).forEach(([groupId, selectedOps]) => {
        if (Array.isArray(selectedOps) && selectedOps.length > 0) {
            const group = optionalGroups.find(g => g.id === groupId);
            const groupName = group ? group.nombre : 'Opcionales';
            html += `<div class="optional-group-name">${groupName}</div>`;
            selectedOps.forEach(op => {
                if (op && op.nombre) {
                    html += `<div class="optional-item">${op.nombre}${op.quantity > 1 ? ` (x${op.quantity})` : ''}</div>`;
                }
                });
        }
    });
    html += '</div>';
    return html;
};