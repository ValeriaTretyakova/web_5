const Joi = require('joi');

const patchSchema = Joi.object({
  type: Joi.string().valid('insert', 'delete', 'cursor').required(),
  position: Joi.number().integer().min(0).required(),
  text: Joi.when('type', {
    is: 'insert',
    then: Joi.string().max(1000).required(),
    otherwise: Joi.string().allow('')
  }),
  length: Joi.when('type', {
    is: 'delete',
    then: Joi.number().integer().min(1).max(100).required(),
    otherwise: Joi.number().integer().min(0)
  }),
  userId: Joi.string().required(),
  timestamp: Joi.number().required(),
  version: Joi.number().integer().min(0).required()
});

// Исправленная валидация для пользователя
const userSchema = Joi.object({
  username: Joi.string().min(1).max(30).pattern(/^[a-zA-Zа-яА-ЯёЁ0-9_\s]+$/).required(),
  color: Joi.string().optional().default('#667eea') // Изменено на 3-6 цифр
});

const validatePatch = (patch) => {
  const { error, value } = patchSchema.validate(patch);
  if (error) {
    throw new Error(`Invalid patch: ${error.message}`);
  }
  return value;
};

const validateUser = (user) => {
  const { error, value } = userSchema.validate(user);
  if (error) {
    throw new Error(`Invalid user data: ${error.message}`);
  }
  
  // Дополнительная обработка: если цвет короткий, расширяем его
  if (value.color && value.color.length === 4) { // #RGB форма
    value.color = `#${value.color[1]}${value.color[1]}${value.color[2]}${value.color[2]}${value.color[3]}${value.color[3]}`;
  }
  
  return value;
};

module.exports = { validatePatch, validateUser };