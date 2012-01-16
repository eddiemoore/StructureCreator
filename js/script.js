/* Author: 

*/

function schemaFileSelect(evt) {
	StructureCreator.schema_file = evt.target.files[0]; // File
	log(StructureCreator.schema_file);
}


document.getElementById('schema_file').addEventListener('change', schemaFileSelect, false);
document.getElementById('create_project').addEventListener('click', StructureCreator.start, false);