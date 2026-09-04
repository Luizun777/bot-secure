// Servidor de ejemplo (fixture): sin secretos reales.
const express = require('express');
express().listen(process.env.PORT || 3000);
