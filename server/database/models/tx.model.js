const { DataTypes } = require('sequelize');

// We export a function that defines the model.
// This function will automatically receive as parameter the Sequelize connection object.
module.exports = (sequelize) => {
	sequelize.define('transaction', {
		id: {
			allowNull: false,
			primaryKey: true,
			type: DataTypes.STRING,
			unique: true
		},
		type: {
			allowNull: false,
			type: DataTypes.STRING
		}
	});
};