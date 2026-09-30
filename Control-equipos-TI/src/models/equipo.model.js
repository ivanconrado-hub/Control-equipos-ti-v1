//Qué hace: Importa la conexión a la base de datos MariaDB y el esquema de MongoDB para las especificaciones de los equipos.
const dbMariaDB = require('../config/db/db');
const EspecificacionMongo = require('./especificacion.schema');

// Auxiliar para parsear especificaciones si llegan como string desde el cliente
const parseSpecs = (specs) => {
  if (!specs) return {};
  if (typeof specs === 'string') {
    try {
      return JSON.parse(specs);
    } catch (e) {
      return {};
    }
  }
  return specs;
};

//Estructura Principal del Modelo de Equipos
const EquipoModel = {
  //Método getAll (Obtener todos los equipos combinando MariaDB y MongoDB)
  getAll: async () => {
    const query = `
      SELECT e.*, i.stock_comprado, i.costo_unitario, i.ubicacion AS inventario_ubicacion, i.observaciones 
      FROM equipos e 
      LEFT JOIN inventario i ON e.id_equipo = i.id_equipo
    `;
    const [rows] = await dbMariaDB.query(query);
    
    const equiposConSpecs = await Promise.all(
      rows.map(async (equipo) => {
        const specs = await EspecificacionMongo.findOne({ id_equipo: equipo.id_equipo });
        const specsObj = specs ? specs.toObject() : {};
        
        const finalImg = equipo.imagen_url || specsObj.imagen_url || '';

        return {
          ...equipo,
          stock_comprado: equipo.stock_comprado || 0,
          costo_unitario: equipo.costo_unitario || 0,
          imagen_url: finalImg,
          especificaciones: {
            ...specsObj,
            imagen_url: finalImg
          }
        };
      })
    );

    return equiposConSpecs;
  },

  //Método create (Crear equipo en MariaDB, registrar su stock y componentes en MongoDB)
  create: async (data) => {
    const { codigo_inventario, tipo_equipo, marca, modelo, ubicacion, estado, stock_comprado, costo_unitario } = data;
    const especificaciones = parseSpecs(data.especificaciones);
    const imgUrl = data.imagen_url || especificaciones.imagen_url || null;

    // Insertar en la tabla equipos
    const queryEquipo = `
      INSERT INTO equipos (codigo_inventario, tipo_equipo, marca, modelo, ubicacion, estado, imagen_url)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
    const [result] = await dbMariaDB.query(queryEquipo, [
      codigo_inventario,
      tipo_equipo,
      marca,
      modelo,
      ubicacion || 'Sin asignar',
      estado || 'disponible',
      imgUrl
    ]);

    const newId = result.insertId;

    // Insertar en la tabla inventario (stock y costos)
    const queryInventario = `
      INSERT INTO inventario (id_equipo, stock_comprado, costo_unitario, ubicacion)
      VALUES (?, ?, ?, ?)
    `;
    await dbMariaDB.query(queryInventario, [
      newId,
      Number(stock_comprado) || 0,
      Number(costo_unitario) || 0.00,
      ubicacion || 'Sin asignar'
    ]);

    // Insertar especificaciones en MongoDB
    if (Object.keys(especificaciones).length > 0 || imgUrl) {
      await EspecificacionMongo.create({
        id_equipo: newId,
        procesador: especificaciones.procesador || 'N/A',
        ram: especificaciones.ram || 'N/A',
        almacenamiento: especificaciones.almacenamiento || 'N/A',
        sistema_operativo: especificaciones.sistema_operativo || 'N/A',
        imagen_url: imgUrl || ''
      });
    }

    return { 
      id_equipo: newId, 
      ...data, 
      stock_comprado: Number(stock_comprado) || 0,
      imagen_url: imgUrl,
      especificaciones: { ...especificaciones, imagen_url: imgUrl || '' }
    };
  },

  //Método update (Actualizar equipo, su inventario y especificaciones en ambas bases de datos)
  update: async (id, data) => {
    const { codigo_inventario, tipo_equipo, marca, modelo, numero_serie, ubicacion, estado, stock_comprado, costo_unitario } = data;
    const especificaciones = parseSpecs(data.especificaciones);
    const imgUrl = data.imagen_url || especificaciones.imagen_url || '';

    // Actualizar MariaDB (equipos)
    const queryEquipo = `
      UPDATE equipos 
      SET codigo_inventario = ?, tipo_equipo = ?, marca = ?, modelo = ?, numero_serie = ?, ubicacion = ?, estado = ?, imagen_url = ?
      WHERE id_equipo = ?
    `;
    await dbMariaDB.query(queryEquipo, [
      codigo_inventario,
      tipo_equipo,
      marca,
      modelo,
      numero_serie || null,
      ubicacion || 'Sin asignar',
      estado || 'disponible',
      imgUrl,
      id
    ]);

    // Actualizar o insertar inventario (Upsert usando ON DUPLICATE KEY UPDATE)
    const queryInventario = `
      INSERT INTO inventario (id_equipo, stock_comprado, costo_unitario, ubicacion)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE 
        stock_comprado = VALUES(stock_comprado),
        costo_unitario = VALUES(costo_unitario),
        ubicacion = VALUES(ubicacion)
    `;
    await dbMariaDB.query(queryInventario, [
      Number(id),
      Number(stock_comprado) || 0,
      Number(costo_unitario) || 0.00,
      ubicacion || 'Sin asignar'
    ]);

    // Actualizar MongoDB (especificaciones)
    await EspecificacionMongo.findOneAndUpdate(
      { id_equipo: Number(id) },
      { 
        $set: {
          procesador: especificaciones.procesador || 'N/A',
          ram: especificaciones.ram || 'N/A',
          almacenamiento: especificaciones.almacenamiento || 'N/A',
          sistema_operativo: especificaciones.sistema_operativo || 'N/A',
          imagen_url: imgUrl
        }
      },
      { upsert: true, new: true }
    );

    return { 
      id_equipo: id, 
      ...data, 
      stock_comprado: Number(stock_comprado) || 0,
      imagen_url: imgUrl,
      especificaciones: { ...especificaciones, imagen_url: imgUrl }
    };
  },

  //Método delete (Eliminar equipo, su inventario y especificaciones)
  delete: async (id) => {
    await dbMariaDB.query('DELETE FROM inventario WHERE id_equipo = ?', [id]);
    const [result] = await dbMariaDB.query('DELETE FROM equipos WHERE id_equipo = ?', [id]);
    await EspecificacionMongo.deleteOne({ id_equipo: Number(id) });

    return result.affectedRows > 0;
  }
};

//Exportación del Modelo
module.exports = EquipoModel;