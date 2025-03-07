// Get the dropzone preview node
var dropzonePreviewNode = document.querySelector('#dropzone-preview-list');

if (dropzonePreviewNode) {
    // Clear the id and get the preview template
    dropzonePreviewNode.id = '';
    var previewTemplate = dropzonePreviewNode.parentNode.innerHTML;
    
    // Remove the preview node from the DOM
    dropzonePreviewNode.parentNode.removeChild(dropzonePreviewNode);
    
    // Initialize Dropzone
    var dropzone = new Dropzone('.dropzone', {
        url: 'https://httpbin.org/post',
        method: 'post',
        previewTemplate: previewTemplate,
        previewsContainer: '#dropzone-preview',
    });
}

// Register FilePond plugins
FilePond.registerPlugin(
    FilePondPluginFileEncode,
    FilePondPluginFileValidateSize,
    FilePondPluginImageExifOrientation,
    FilePondPluginImagePreview
);

// Get all input elements with the class 'filepond-input-multiple'
var inputMultipleElements = document.querySelectorAll('input.filepond-input-multiple');

// Create FilePond instances for each input element
if (inputMultipleElements) {
    Array.from(inputMultipleElements).forEach(function (element) {
        FilePond.create(element);
    });

    // Create a FilePond instance with specific options for the element with class 'filepond-input-circle'
    FilePond.create(document.querySelector('.filepond-input-circle'), {
        labelIdle: 'Drag & Drop your picture or <span class="filepond--label-action">Browse</span>',
        imagePreviewHeight: 170,
        imageCropAspectRatio: '1:1',
        imageResizeTargetWidth: 200,
        imageResizeTargetHeight: 200,
        stylePanelLayout: 'compact circle',
        styleLoadIndicatorPosition: 'center bottom',
        styleProgressIndicatorPosition: 'right bottom',
        styleButtonRemoveItemPosition: 'left bottom',
        styleButtonProcessItemPosition: 'right bottom',
    });
}
