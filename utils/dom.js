/**
 * Cria um elemento HTML com atributos e filhos.
 * @param {string} tag - A tag do elemento (ex: 'div').
 * @param {object} [attributes={}] - Objeto de atributos (ex: { className, id, dataset }).
 * @param {Array<Node|string>} [children=[]] - Array de nós filhos ou strings.
 * @returns {HTMLElement}
 */
function createEl(tag, attributes = {}, children = []) {
  const element = document.createElement(tag);
  for (const key in attributes) {
    if (key === 'dataset') {
      for (const dataKey in attributes.dataset) {
        element.dataset[dataKey] = attributes.dataset[dataKey];
      }
    } else if (key === 'className') {
      element.className = attributes[key];
    } else if (key === 'innerHTML') {
      element.innerHTML = attributes[key];
    } else if (key in element && key !== 'style') {
      element[key] = attributes[key];
    } else {
      element.setAttribute(key, attributes[key]);
    }
  }
  for (const child of children) {
    element.append(child);
  }
  return element;
}
