/* Author: 

*/

/*function schemaFileSelect(evt) {
	StructureCreator.schema_file = evt.target.files[0]; // File
	log(StructureCreator.schema_file);
}

$(function() {
	$('#create_project').click(function() {
		StructureCreator.start();
	});
});
document.getElementById('schema_file').addEventListener('change', schemaFileSelect, false);
//document.getElementById('create_project').addEventListener('click', StructureCreator.start, false);
*/
window.domain = 'github.com';

var sc = new StructureCreator(),
	schema_file = document.getElementById('schema_file'),
	create_btn = document.getElementById('create_project');

console.log(StructureCreator.schema_file);
function schemaFileSelect(evt) {
	StructureCreator.schema_file = evt.target.files[0]; // File
	log('schema file');
	log(StructureCreator.schema_file);
}

function startCreation() {
	sc.init();
}

schema_file.addEventListener('change', schemaFileSelect);
create_btn.addEventListener('click', startCreation);