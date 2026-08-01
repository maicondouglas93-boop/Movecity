const express = require('express');
const router = express.Router();
const vehicleCategoryController = require('../controllers/vehicleCategory.controller');

// Pública (sem auth): o cadastro do motorista precisa listar categorias antes de o
// motorista ter uma conta, e o app do passageiro usa a mesma fonte de dados.
router.get('/', vehicleCategoryController.getActiveCategories);

module.exports = router;
