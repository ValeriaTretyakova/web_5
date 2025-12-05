require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5000;

// Разрешаем все CORS запросы для тестирования
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  credentials: true
}));

app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// Документ с версионированием
let documentState = {
  content: 'Добро пожаловать в совместный редактор!\n\nНачните печатать здесь...',
  version: 0,
  lastModified: Date.now()
};

let users = new Map();
// Храним последние операции для каждого пользователя
let userLastOperations = new Map();
// Карта блокировок позиций
let positionLocks = new Map();
// Очередь операций для обработки
let operationQueue = [];
let isProcessingQueue = false;

// Настройка Socket.IO
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling'],
  allowEIO3: true
});

// Функция для обработки очереди операций
async function processOperationQueue() {
  if (isProcessingQueue || operationQueue.length === 0) return;
  
  isProcessingQueue = true;
  
  while (operationQueue.length > 0) {
    const operationData = operationQueue.shift();
    try {
      await processSingleOperation(operationData);
    } catch (error) {
      console.error('Ошибка обработки операции:', error);
      const { socket, patch, resolve, reject } = operationData;
      if (reject) reject(error);
    }
  }
  
  isProcessingQueue = false;
}

// Функция обработки одной операции
function processSingleOperation({ socket, patch, user }) {
  return new Promise((resolve, reject) => {
    try {
      console.log('Обработка операции от', user.username, 'версия клиента:', patch.version, 'версия сервера:', documentState.version);
      
      // Проверяем версию
      if (patch.version !== documentState.version) {
        console.log('Версия не совпадает, требуется трансформация');
        // Отправляем клиенту актуальное состояние
        socket.emit('version-mismatch', {
          currentVersion: documentState.version,
          currentContent: documentState.content,
          clientVersion: patch.version
        });
        resolve({ skipped: true, reason: 'version mismatch' });
        return;
      }
      
      // Проверяем позицию
      if (patch.type === 'insert') {
        const maxPosition = documentState.content.length;
        const position = Math.min(Math.max(0, patch.position || 0), maxPosition);
        
        // Корректируем позицию если нужно
        if (position !== patch.position) {
          console.log(`Корректировка позиции с ${patch.position} на ${position}`);
          patch.position = position;
        }
        
        // Применяем изменение
        documentState.content = documentState.content.slice(0, position) + 
                               (patch.text || '') + 
                               documentState.content.slice(position);
        console.log(`✅ Вставлено "${patch.text}" на позицию ${position}`);
        
      } else if (patch.type === 'delete') {
        const maxPosition = documentState.content.length;
        const position = Math.min(Math.max(0, patch.position || 0), maxPosition);
        const length = Math.min(patch.length || 1, documentState.content.length - position);
        
        // Корректируем позицию если нужно
        if (position !== patch.position) {
          console.log(`Корректировка позиции удаления с ${patch.position} на ${position}`);
          patch.position = position;
        }
        
        // Проверяем что удаляемый текст совпадает
        const textToDelete = documentState.content.substring(position, position + length);
        if (patch.text && patch.text !== textToDelete) {
          console.log('⚠️ Текст для удаления не совпадает, корректируем');
          patch.text = textToDelete;
        }
        
        documentState.content = documentState.content.slice(0, position) + 
                               documentState.content.slice(position + length);
        console.log(`✅ Удалено ${length} символов с позиции ${position}`);
      }
      
      // Увеличиваем версию
      documentState.version++;
      documentState.lastModified = Date.now();
      
      // Сохраняем последнюю операцию пользователя
      userLastOperations.set(socket.id, {
        patch,
        timestamp: Date.now(),
        version: documentState.version
      });
      
      // Рассылаем изменение всем остальным пользователям
      socket.broadcast.emit('apply-patch', {
        ...patch,
        userColor: user.color,
        username: user.username,
        userId: socket.id,
        version: documentState.version,
        serverTimestamp: Date.now()
      });
      
      // Отправляем подтверждение отправителю
      socket.emit('operation-confirmed', {
        patchId: patch.id,
        version: documentState.version,
        position: patch.position,
        serverTimestamp: Date.now()
      });
      
      console.log('📄 Документ обновлен:', {
        длина: documentState.content.length,
        версия: documentState.version,
        пользователь: user.username
      });
      
      resolve({ success: true, version: documentState.version });
      
    } catch (error) {
      console.error('❌ Ошибка обработки операции:', error);
      reject(error);
    }
  });
}

// Обработка подключений
io.on('connection', (socket) => {
  console.log('🟢 Новое подключение:', socket.id);
  
  // Регистрация пользователя
  socket.on('register', (userData) => {
    try {
      console.log('📝 Регистрация:', userData);
      
      const user = {
        id: socket.id,
        username: userData.username || `User${Math.floor(Math.random() * 1000)}`,
        color: userData.color || `#${Math.floor(Math.random()*16777215).toString(16)}`,
        cursorPosition: 0,
        lastActive: Date.now()
      };
      
      users.set(socket.id, user);
      
      // Отправляем подтверждение регистрации
      socket.emit('registration-success', {
        userId: socket.id,
        username: user.username,
        color: user.color
      });
      
      // Отправляем текущее состояние
      socket.emit('document-state', {
        content: documentState.content,
        version: documentState.version,
        lastModified: documentState.lastModified
      });
      
      // Уведомляем всех о новом пользователе
      io.emit('users-update', Array.from(users.values()));
      
      console.log(`✅ Пользователь ${user.username} зарегистрирован`);
      
    } catch (error) {
      console.error('❌ Ошибка регистрации:', error);
      socket.emit('registration-error', { message: 'Ошибка регистрации' });
    }
  });
  
  // Обработка изменений текста с очередью
  socket.on('text-change', (patch) => {
    try {
      console.log('📩 Получено text-change от:', socket.id);
      
      // Проверяем регистрацию
      if (!users.has(socket.id)) {
        console.log('❌ Пользователь не зарегистрирован');
        socket.emit('error', { 
          message: 'Вы не зарегистрированы' 
        });
        return;
      }
      
      const user = users.get(socket.id);
      user.lastActive = Date.now();
      
      // Добавляем временную метку если её нет
      if (!patch.timestamp) {
        patch.timestamp = Date.now();
      }
      
      // Добавляем ID если его нет
      if (!patch.id) {
        patch.id = socket.id + '_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      }
      
      // Добавляем операцию в очередь
      operationQueue.push({
        socket,
        patch,
        user,
        resolve: (result) => {
          if (result.skipped) {
            console.log('Операция пропущена:', result.reason);
          }
        },
        reject: (error) => {
          console.error('Ошибка в операции:', error);
          socket.emit('operation-error', {
            patchId: patch.id,
            error: error.message
          });
        }
      });
      
      // Запускаем обработку очереди
      processOperationQueue();
      
    } catch (error) {
      console.error('❌ Ошибка при получении text-change:', error);
      socket.emit('error', { message: 'Ошибка при обработке запроса' });
    }
  });
  
  // Обработка массовых изменений (оптимизация)
  socket.on('batch-operations', (operations) => {
    try {
      if (!users.has(socket.id)) return;
      
      const user = users.get(socket.id);
      user.lastActive = Date.now();
      
      // Обрабатываем операции по порядку
      operations.forEach((patch, index) => {
        setTimeout(() => {
          operationQueue.push({
            socket,
            patch: {
              ...patch,
              timestamp: patch.timestamp || Date.now() + index,
              id: patch.id || `${socket.id}_batch_${Date.now()}_${index}`
            },
            user,
            resolve: () => {},
            reject: () => {}
          });
        }, index * 10); // Небольшая задержка между операциями
      });
      
      processOperationQueue();
      
    } catch (error) {
      console.error('Ошибка batch операций:', error);
    }
  });
  
  // Обновление позиции курсора
  socket.on('cursor-move', (position) => {
    const user = users.get(socket.id);
    if (user) {
      user.cursorPosition = position;
      user.lastActive = Date.now();
      socket.broadcast.emit('cursor-update', {
        userId: socket.id,
        position: position,
        username: user.username,
        color: user.color,
        timestamp: Date.now()
      });
    }
  });
  
  // Обработка несовпадения версий
  socket.on('sync-request', ({ version }) => {
    if (users.has(socket.id)) {
      socket.emit('document-state', {
        content: documentState.content,
        version: documentState.version,
        lastModified: documentState.lastModified
      });
    }
  });
  
  // Отправка пинга
  socket.on('ping', (callback) => {
    if (callback) callback();
  });
  
  // Отправляем текущих пользователей новому подключению
  socket.emit('users-update', Array.from(users.values()));
  
  // Обработка отключения
  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user) {
      console.log(`🔴 Пользователь отключен: ${user.username}`);
      users.delete(socket.id);
      userLastOperations.delete(socket.id);
      io.emit('user-disconnected', socket.id);
      io.emit('users-update', Array.from(users.values()));
    }
  });
});

// Очистка старых блокировок каждые 5 секунд
setInterval(() => {
  const now = Date.now();
  positionLocks.forEach((lock, key) => {
    if (now - lock.timestamp > 5000) { // 5 секунд
      positionLocks.delete(key);
    }
  });
}, 5000);

// Маршруты
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    users: users.size,
    document: {
      length: documentState.content.length,
      version: documentState.version,
      lastModified: documentState.lastModified
    },
    queueLength: operationQueue.length
  });
});

app.get('/document', (req, res) => {
  res.status(200).json({
    content: documentState.content,
    length: documentState.content.length,
    version: documentState.version
  });
});

// Запуск сервера
const HOST = process.env.HOST || '0.0.0.0';
server.listen(PORT, HOST, () => {
  console.log(`🚀 Сервер запущен на http://${HOST}:${PORT}`);
  console.log(`📄 Документ: ${documentState.content.length} символов, версия: ${documentState.version}`);
  console.log(`👥 Пользователей: ${users.size}`);
});