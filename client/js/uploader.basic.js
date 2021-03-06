/*jslint browser: true, unparam: true, indent: 2 */
/*globals qq */

qq.FineUploaderBasic = function (o) {
  "use strict";
  var that = this;
  this.options = {
    debug: false,
    button: null,
    multiple: true,
    maxConnections: 3,
    disableCancelForFormUploads: false,
    autoUpload: true,
    request: {
      endpoint: '/server/upload',
      params: {},
      paramsInBody: true,
      customHeaders: {},
      forceMultipart: true,
      inputName: 'qqfile',
      uuidName: 'qquuid',
      totalFileSizeName: 'qqtotalfilesize'
    },
    validation: {
      allowedExtensions: [],
      sizeLimit: 0,
      minSizeLimit: 0,
      stopOnFirstInvalidFile: true
    },
    callbacks: {
      onSubmit: function (id, name) {},
      onComplete: function (id, name, responseJSON) {},
      onCancel: function (id, name) {},
      onUpload: function (id, name) {},
      onUploadChunk: function (id, name, chunkData) {},
      onResume: function (id, fileName, chunkData) {},
      onProgress: function (id, name, loaded, total) {},
      onError: function (id, name, reason) {},
      onAutoRetry: function (id, name, attemptNumber) {},
      onManualRetry: function (id, name) {},
      onValidateBatch: function (fileOrBlobData) {},
      onValidate: function (fileOrBlobData) {},
      onSubmitDelete: function (id) {},
      onDelete: function (id) {},
      onDeleteComplete: function (id, xhr, isError) {}
    },
    messages: {
      typeError: "{file} has an invalid extension. Valid extension(s): {extensions}.",
      sizeError: "{file} is too large, maximum file size is {sizeLimit}.",
      minSizeError: "{file} is too small, minimum file size is {minSizeLimit}.",
      emptyError: "{file} is empty, please select files again without it.",
      noFilesError: "No files to upload.",
      onLeave: "The files are being uploaded, if you leave now the upload will be cancelled."
    },
    retry: {
      enableAuto: false,
      maxAutoAttempts: 3,
      autoAttemptDelay: 5,
      preventRetryResponseProperty: 'preventRetry'
    },
    classes: {
      buttonHover: 'qq-upload-button-hover',
      buttonFocus: 'qq-upload-button-focus'
    },
    chunking: {
      enabled: false,
      partSize: 2000000,
      paramNames: {
        partIndex: 'qqpartindex',
        partByteOffset: 'qqpartbyteoffset',
        chunkSize: 'qqchunksize',
        totalFileSize: 'qqtotalfilesize',
        totalParts: 'qqtotalparts',
        filename: 'qqfilename'
      }
    },
    resume: {
      enabled: false,
      id: null,
      cookiesExpireIn: 7, //days
      paramNames: {
        resuming: "qqresume"
      }
    },
    formatFileName: function (fileOrBlobName) {
      if (fileOrBlobName.length > 33) {
        fileOrBlobName = fileOrBlobName.slice(0, 19) + '...' + fileOrBlobName.slice(-14);
      }
      return fileOrBlobName;
    },
    text: {
      sizeSymbols: ['kB', 'MB', 'GB', 'TB', 'PB', 'EB']
    },
    deleteFile: {
      enabled: false,
      endpoint: '/server/upload',
      customHeaders: {},
      params: {}
    },
    cors: {
      expected: false,
      sendCredentials: false
    },
    blobs: {
      defaultName: 'Misc data',
      paramNames: {
        name: 'qqblobname'
      }
    }
  };
  qq.extend(this.options, o, true);
  this.wrapCallbacks();
  this.disposeSupport = new qq.DisposeSupport();
  // number of files being uploaded
  this.filesInProgress = [];
  this.storedIds = [];
  this.autoRetries = [];
  this.retryTimeouts = [];
  this.preventRetries = [];
  this.paramsStore = this.createParamsStore("request");
  this.deleteFileParamsStore = this.createParamsStore("deleteFile");
  this.endpointStore = this.createEndpointStore("request");
  this.deleteFileEndpointStore = this.createEndpointStore("deleteFile");
  this.handler = this.createUploadHandler();
  this.deleteHandler = this.createDeleteHandler();
  if (this.options.button) {
    this.button = this.createUploadButton(this.options.button);
  }
  this.preventLeaveInProgress();
};
qq.FineUploaderBasic.prototype = {
  log: function (str, level) {
    if (this.options.debug && (!level || level === 'info')) {
      qq.log('[FineUploader] ' + str);
    } else if (level && level !== 'info') {
      qq.log('[FineUploader] ' + str, level);
    }
  },
  setParams: function (params, id) {
    /*jshint eqeqeq: true, eqnull: true*/
    if (id == null) {
      this.options.request.params = params;
    } else {
      this.paramsStore.setParams(params, id);
    }
  },
  setDeleteFileParams: function (params, id) {
    /*jshint eqeqeq: true, eqnull: true*/
    if (id == null) {
      this.options.deleteFile.params = params;
    } else {
      this.deleteFileParamsStore.setParams(params, id);
    }
  },
  setEndpoint: function (endpoint, id) {
    /*jshint eqeqeq: true, eqnull: true*/
    if (id == null) {
      this.options.request.endpoint = endpoint;
    } else {
      this.endpointStore.setEndpoint(endpoint, id);
    }
  },
  getInProgress: function () {
    return this.filesInProgress.length;
  },
  uploadStoredFiles: function () {
    "use strict";
    var idToUpload;
    while (this.storedIds.length) {
      idToUpload = this.storedIds.shift();
      this.filesInProgress.push(idToUpload);
      this.handler.upload(idToUpload);
    }
  },
  clearStoredFiles: function () {
    this.storedIds = [];
  },
  retry: function (id) {
    if (this._onBeforeManualRetry(id)) {
      this.handler.retry(id);
      return true;
    } else {
      return false;
    }
  },
  cancel: function (id) {
    this.handler.cancel(id);
  },
  cancelAll: function () {
    var storedIdsCopy = [],
      self = this;
    qq.extend(storedIdsCopy, this.storedIds);
    qq.each(storedIdsCopy, function (idx, storedFileId) {
      self.cancel(storedFileId);
    });
    this.handler.cancelAll();
  },
  reset: function () {
    this.log("Resetting uploader...");
    this.handler.reset();
    this.filesInProgress = [];
    this.storedIds = [];
    this.autoRetries = [];
    this.retryTimeouts = [];
    this.preventRetries = [];
    this.button.reset();
    this.paramsStore.reset();
    this.endpointStore.reset();
  },
  addFiles: function (filesBlobDataOrInputs) {
    var self = this,
      verifiedFilesOrInputs = [],
      index, fileOrInput;
    if (filesBlobDataOrInputs) {
      if (!window.FileList || !(filesBlobDataOrInputs instanceof FileList)) {
        filesBlobDataOrInputs = [].concat(filesBlobDataOrInputs);
      }
      for (index = 0; index < filesBlobDataOrInputs.length; index += 1) {
        fileOrInput = filesBlobDataOrInputs[index];
        if (qq.isFileOrInput(fileOrInput)) {
          verifiedFilesOrInputs.push(fileOrInput);
        } else {
          self.log(fileOrInput + ' is not a File or INPUT element!  Ignoring!', 'warn');
        }
      }
      this.log('Processing ' + verifiedFilesOrInputs.length + ' files or inputs...');
      this.uploadFileOrBlobDataList(verifiedFilesOrInputs);
    }
  },
  addBlobs: function (blobDataOrArray) {
    if (blobDataOrArray) {
      var blobDataArray = [].concat(blobDataOrArray),
        verifiedBlobDataList = [],
        self = this;
      qq.each(blobDataArray, function (idx, blobData) {
        if (qq.isBlob(blobData) && !qq.isFileOrInput(blobData)) {
          verifiedBlobDataList.push({
            blob: blobData,
            name: self.options.blobs.defaultName
          });
        } else if (qq.isObject(blobData) && blobData.blob && blobData.name) {
          verifiedBlobDataList.push(blobData);
        } else {
          self.log("addBlobs: entry at index " + idx + " is not a Blob or a BlobData object", "error");
        }
      });
      this.uploadFileOrBlobDataList(verifiedBlobDataList);
    } else {
      this.log("undefined or non-array parameter passed into addBlobs", "error");
    }
  },
  getUuid: function (id) {
    return this.handler.getUuid(id);
  },
  getResumableFilesData: function () {
    return this.handler.getResumableFilesData();
  },
  getSize: function (id) {
    return this.handler.getSize(id);
  },
  getFile: function (fileOrBlobId) {
    return this.handler.getFile(fileOrBlobId);
  },
  deleteFile: function (id) {
    this.onSubmitDelete(id);
  },
  setDeleteFileEndpoint: function (endpoint, id) {
    /*jshint eqeqeq: true, eqnull: true*/
    if (id == null) {
      this.options.deleteFile.endpoint = endpoint;
    } else {
      this.deleteFileEndpointStore.setEndpoint(endpoint, id);
    }
  },
  createUploadButton: function (element) {
    var self = this;
    var button = new qq.UploadButton({
      element: element,
      multiple: this.options.multiple && qq.isXhrUploadSupported(),
      acceptFiles: this.options.validation.acceptFiles,
      onChange: function (input) {
        self.onInputChange(input);
      },
      hoverClass: this.options.classes.buttonHover,
      focusClass: this.options.classes.buttonFocus
    });
    this.disposeSupport.addDisposer(function () {
      button.dispose();
    });
    return button;
  },
  createUploadHandler: function () {
    var self = this;
    return new qq.UploadHandler({
      debug: this.options.debug,
      forceMultipart: this.options.request.forceMultipart,
      maxConnections: this.options.maxConnections,
      customHeaders: this.options.request.customHeaders,
      inputName: this.options.request.inputName,
      uuidParamName: this.options.request.uuidName,
      totalFileSizeParamName: this.options.request.totalFileSizeName,
      cors: this.options.cors,
      demoMode: this.options.demoMode,
      paramsInBody: this.options.request.paramsInBody,
      paramsStore: this.paramsStore,
      endpointStore: this.endpointStore,
      chunking: this.options.chunking,
      resume: this.options.resume,
      blobs: this.options.blobs,
      log: function (str, level) {
        self.log(str, level);
      },
      onProgress: function (id, name, loaded, total) {
        self.onProgress(id, name, loaded, total);
        self.options.callbacks.onProgress(id, name, loaded, total);
      },
      onComplete: function (id, name, result, xhr) {
        self.onComplete(id, name, result, xhr);
        self.options.callbacks.onComplete(id, name, result);
      },
      onCancel: function (id, name) {
        self.onCancel(id, name);
        self.options.callbacks.onCancel(id, name);
      },
      onUpload: function (id, name) {
        self.onUpload(id, name);
        self.options.callbacks.onUpload(id, name);
      },
      onUploadChunk: function (id, name, chunkData) {
        self.options.callbacks.onUploadChunk(id, name, chunkData);
      },
      onResume: function (id, name, chunkData) {
        return self.options.callbacks.onResume(id, name, chunkData);
      },
      onAutoRetry: function (id, name, responseJSON, xhr) {
        self.preventRetries[id] = responseJSON[self.options.retry.preventRetryResponseProperty];
        if (self._shouldAutoRetry(id, name, responseJSON)) {
          self.maybeParseAndSendUploadError(id, name, responseJSON, xhr);
          self.options.callbacks.onAutoRetry(id, name, self.autoRetries[id] + 1);
          self._onBeforeAutoRetry(id, name);
          self.retryTimeouts[id] = setTimeout(function () {
            self._onAutoRetry(id, name, responseJSON)
          }, self.options.retry.autoAttemptDelay * 1000);
          return true;
        } else {
          return false;
        }
      }
    });
  },
  createDeleteHandler: function () {
    var self = this;
    return new qq.DeleteFileAjaxRequestor({
      maxConnections: this.options.maxConnections,
      customHeaders: this.options.deleteFile.customHeaders,
      paramsStore: this.deleteFileParamsStore,
      endpointStore: this.deleteFileEndpointStore,
      demoMode: this.options.demoMode,
      cors: this.options.cors,
      log: function (str, level) {
        self.log(str, level);
      },
      onDelete: function (id) {
        self.onDelete(id);
        self.options.callbacks.onDelete(id);
      },
      onDeleteComplete: function (id, xhr, isError) {
        self.onDeleteComplete(id, xhr, isError);
        self.options.callbacks.onDeleteComplete(id, xhr, isError);
      }
    });
  },
  preventLeaveInProgress: function () {
    var self = this;
    this.disposeSupport.attach(window, 'beforeunload', function (e) {
      if (!self.filesInProgress.length) {
        return;
      }
      var e = e || window.event;
      // for ie, ff
      e.returnValue = self.options.messages.onLeave;
      // for webkit
      return self.options.messages.onLeave;
    });
  },
  onSubmit: function (id, name) {
    if (this.options.autoUpload) {
      this.filesInProgress.push(id);
    }
  },
  onProgress: function (id, name, loaded, total) {},
  onComplete: function (id, name, result, xhr) {
    this.removeFromFilesInProgress(id);
    this.maybeParseAndSendUploadError(id, name, result, xhr);
  },
  onCancel: function (id, name) {
    this.removeFromFilesInProgress(id);
    clearTimeout(this.retryTimeouts[id]);
    var storedItemIndex = qq.indexOf(this.storedIds, id);
    if (!this.options.autoUpload && storedItemIndex >= 0) {
      this.storedIds.splice(storedItemIndex, 1);
    }
  },
  isDeletePossible: function () {
    return (this.options.deleteFile.enabled &&
      (!this.options.cors.expected ||
        (this.options.cors.expected && (qq.ie10() || !qq.ie()))
      )
    );
  },
  onSubmitDelete: function (id) {
    if (this.isDeletePossible()) {
      if (this.options.callbacks.onSubmitDelete(id)) {
        this.deleteHandler.sendDelete(id, this.getUuid(id));
      }
    } else {
      this.log("Delete request ignored for ID " + id + ", delete feature is disabled or request not possible " +
        "due to CORS on a user agent that does not support pre-flighting.", "warn");
      return false;
    }
  },
  onDelete: function (fileId) {},
  onDeleteComplete: function (id, xhr, isError) {
    var name = this.handler.getName(id);
    if (isError) {
      this.log("Delete request for '" + name + "' has failed.", "error");
      this.options.callbacks.onError(id, name, "Delete request failed with response code " + xhr.status);
    } else {
      this.log("Delete request for '" + name + "' has succeeded.");
    }
  },
  removeFromFilesInProgress: function (id) {
    var index = qq.indexOf(this.filesInProgress, id);
    if (index >= 0) {
      this.filesInProgress.splice(index, 1);
    }
  },
  onUpload: function (id, name) {},
  onInputChange: function (input) {
    if (qq.isXhrUploadSupported()) {
      this.addFiles(input.files);
    } else {
      this.addFiles(input);
    }
    this.button.reset();
  },
  _onBeforeAutoRetry: function (id, name) {
    this.log("Waiting " + this.options.retry.autoAttemptDelay + " seconds before retrying " + name + "...");
  },
  _onAutoRetry: function (id, name, responseJSON) {
    this.log("Retrying " + name + "...");
    this.autoRetries[id]++;
    this.handler.retry(id);
  },
  _shouldAutoRetry: function (id, name, responseJSON) {
    if (!this.preventRetries[id] && this.options.retry.enableAuto) {
      if (this.autoRetries[id] === undefined) {
        this.autoRetries[id] = 0;
      }
      return this.autoRetries[id] < this.options.retry.maxAutoAttempts
    }
    return false;
  },
  //return false if we should not attempt the requested retry
  _onBeforeManualRetry: function (id) {
    if (this.preventRetries[id]) {
      this.log("Retries are forbidden for id " + id, 'warn');
      return false;
    } else if (this.handler.isValid(id)) {
      var fileName = this.handler.getName(id);
      if (this.options.callbacks.onManualRetry(id, fileName) === false) {
        return false;
      }
      this.log("Retrying upload for '" + fileName + "' (id: " + id + ")...");
      this.filesInProgress.push(id);
      return true;
    } else {
      this.log("'" + id + "' is not a valid file ID", 'error');
      return false;
    }
  },
  maybeParseAndSendUploadError: function (id, name, response, xhr) {
    //assuming no one will actually set the response code to something other than 200 and still set 'success' to true
    if (!response.success) {
      if (xhr && xhr.status !== 200 && !response.error) {
        this.options.callbacks.onError(id, name, "XHR returned response code " + xhr.status);
      } else {
        var errorReason = response.error ? response.error : "Upload failure reason unknown";
        this.options.callbacks.onError(id, name, errorReason);
      }
    }
  },
  uploadFileOrBlobDataList: function (fileOrBlobDataList) {
    var validationDescriptors, index, batchInvalid;
    validationDescriptors = this.getValidationDescriptors(fileOrBlobDataList);
    batchInvalid = this.options.callbacks.onValidateBatch(validationDescriptors) === false;
    if (!batchInvalid) {
      if (fileOrBlobDataList.length > 0) {
        for (index = 0; index < fileOrBlobDataList.length; index++) {
          if (this.validateFileOrBlobData(fileOrBlobDataList[index])) {
            this.upload(fileOrBlobDataList[index]);
          } else {
            if (this.options.validation.stopOnFirstInvalidFile) {
              return;
            }
          }
        }
      } else {
        this.error('noFilesError', "");
      }
    }
  },
  upload: function (blobOrFileContainer) {
    var id = this.handler.add(blobOrFileContainer);
    var name = this.handler.getName(id);
    if (this.options.callbacks.onSubmit(id, name) !== false) {
      this.onSubmit(id, name);
      if (this.options.autoUpload) {
        this.handler.upload(id);
      } else {
        this.storeForLater(id);
      }
    }
  },
  storeForLater: function (id) {
    this.storedIds.push(id);
  },
  validateFileOrBlobData: function (fileOrBlobData) {
    var validationDescriptor, name, size;
    validationDescriptor = this.getValidationDescriptor(fileOrBlobData);
    name = validationDescriptor.name;
    size = validationDescriptor.size;
    if (this.options.callbacks.onValidate(validationDescriptor) === false) {
      return false;
    }
    if (qq.isFileOrInput(fileOrBlobData) && !this.isAllowedExtension(name)) {
      this.error('typeError', name);
      return false;
    } else if (size === 0) {
      this.error('emptyError', name);
      return false;
    } else if (size && this.options.validation.sizeLimit && size > this.options.validation.sizeLimit) {
      this.error('sizeError', name);
      return false;
    } else if (size && size < this.options.validation.minSizeLimit) {
      this.error('minSizeError', name);
      return false;
    }
    return true;
  },
  error: function (code, name) {
    var message = this.options.messages[code];

    function r(name, replacement) {
      message = message.replace(name, replacement);
    }
    var extensions = this.options.validation.allowedExtensions.join(', ').toLowerCase();
    r('{file}', this.options.formatFileName(name));
    r('{extensions}', extensions);
    r('{sizeLimit}', this.formatSize(this.options.validation.sizeLimit));
    r('{minSizeLimit}', this.formatSize(this.options.validation.minSizeLimit));
    this.options.callbacks.onError(null, name, message);
    return message;
  },
  isAllowedExtension: function (fileName) {
    var allowed = this.options.validation.allowedExtensions,
      valid = false;
    if (!allowed.length) {
      return true;
    }
    qq.each(allowed, function (idx, allowedExt) {
      /*jshint eqeqeq: true, eqnull: true*/
      var extRegex = new RegExp('\\.' + allowedExt + "$", 'i');
      if (fileName.match(extRegex) != null) {
        valid = true;
        return false;
      }
    });
    return valid;
  },
  formatSize: function (bytes) {
    var i = -1;
    do {
      bytes = bytes / 1024;
      i++;
    } while (bytes > 99);
    return Math.max(bytes, 0.1).toFixed(1) + this.options.text.sizeSymbols[i];
  },
  wrapCallbacks: function () {
    var self, safeCallback;
    self = this;
    safeCallback = function (name, callback, args) {
      try {
        return callback.apply(self, args);
      } catch (exception) {
        self.log("Caught exception in '" + name + "' callback - " + exception.message, 'error');
      }
    }
    for (var prop in this.options.callbacks) {
      (function () {
        var callbackName, callbackFunc;
        callbackName = prop;
        callbackFunc = self.options.callbacks[callbackName];
        self.options.callbacks[callbackName] = function () {
          return safeCallback(callbackName, callbackFunc, arguments);
        }
      }());
    }
  },
  parseFileOrBlobDataName: function (fileOrBlobData) {
    var name;
    if (qq.isFileOrInput(fileOrBlobData)) {
      if (fileOrBlobData.value) {
        // it is a file input
        // get input value and remove path to normalize
        name = fileOrBlobData.value.replace(/.*(\/|\\)/, "");
      } else {
        // fix missing properties in Safari 4 and firefox 11.0a2
        name = (fileOrBlobData.fileName !== null && fileOrBlobData.fileName !== undefined) ? fileOrBlobData.fileName : fileOrBlobData.name;
      }
    } else {
      name = fileOrBlobData.name;
    }
    return name;
  },
  parseFileOrBlobDataSize: function (fileOrBlobData) {
    var size;
    if (qq.isFileOrInput(fileOrBlobData)) {
      if (!fileOrBlobData.value) {
        // fix missing properties in Safari 4 and firefox 11.0a2
        size = (fileOrBlobData.fileSize !== null && fileOrBlobData.fileSize !== undefined) ? fileOrBlobData.fileSize : fileOrBlobData.size;
      }
    } else {
      size = fileOrBlobData.blob.size;
    }
    return size;
  },
  getValidationDescriptor: function (fileOrBlobData) {
    var name, size, fileDescriptor;
    fileDescriptor = {};
    name = this.parseFileOrBlobDataName(fileOrBlobData);
    size = this.parseFileOrBlobDataSize(fileOrBlobData);
    fileDescriptor.name = name;
    if (size) {
      fileDescriptor.size = size;
    }
    return fileDescriptor;
  },
  getValidationDescriptors: function (files) {
    var self = this,
      fileDescriptors = [];
    qq.each(files, function (idx, file) {
      fileDescriptors.push(self.getValidationDescriptor(file));
    });
    return fileDescriptors;
  },
  createParamsStore: function (type) {
    var paramsStore = {},
      self = this;
    return {
      setParams: function (params, id) {
        var paramsCopy = {};
        qq.extend(paramsCopy, params);
        paramsStore[id] = paramsCopy;
      },
      getParams: function (id) {
        /*jshint eqeqeq: true, eqnull: true*/
        var paramsCopy = {};
        if (id != null && paramsStore[id]) {
          qq.extend(paramsCopy, paramsStore[id]);
        } else {
          qq.extend(paramsCopy, self.options[type].params);
        }
        return paramsCopy;
      },
      remove: function (fileId) {
        return delete paramsStore[fileId];
      },
      reset: function () {
        paramsStore = {};
      }
    };
  },
  createEndpointStore: function (type) {
    var endpointStore = {},
      self = this;
    return {
      setEndpoint: function (endpoint, id) {
        endpointStore[id] = endpoint;
      },
      getEndpoint: function (id) {
        /*jshint eqeqeq: true, eqnull: true*/
        if (id != null && endpointStore[id]) {
          return endpointStore[id];
        }
        return self.options[type].endpoint;
      },
      remove: function (fileId) {
        return delete endpointStore[fileId];
      },
      reset: function () {
        endpointStore = {};
      }
    };
  }
};

