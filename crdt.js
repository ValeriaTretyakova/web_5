class CRDTDocument {
  constructor() {
    this.content = '';
    this.version = 0;
    this.pendingOperations = [];
  }

  applyOperation(operation) {
    // Проверяем, не устарела ли операция
    if (operation.version < this.version) {
      // Операция устарела, нужно трансформировать
      return this.transformOperation(operation);
    }

    // Применяем операцию
    switch (operation.type) {
      case 'insert':
        if (operation.position <= this.content.length) {
          this.content = this.content.slice(0, operation.position) + 
                         operation.text + 
                         this.content.slice(operation.position);
        }
        break;
      case 'delete':
        if (operation.position + operation.length <= this.content.length) {
          this.content = this.content.slice(0, operation.position) + 
                         this.content.slice(operation.position + operation.length);
        }
        break;
    }
    
    this.version++;
    return operation;
  }

  transformOperation(incomingOp) {
    // Простая трансформация: если позиция изменилась из-за других операций,
    // корректируем позицию входящей операции
    let adjustedOp = { ...incomingOp };
    
    // Для демо просто увеличиваем версию и применяем "как есть"
    // В реальном приложении здесь была бы сложная логика трансформации
    adjustedOp.version = this.version;
    
    // Простая коррекция позиции для демонстрации
    if (adjustedOp.position > this.content.length) {
      adjustedOp.position = this.content.length;
    }
    
    return this.applyOperation(adjustedOp);
  }

  getState() {
    return {
      content: this.content,
      version: this.version
    };
  }
}

module.exports = CRDTDocument;
