
var toastTrigger2 = document.getElementById('borderedToast1Btn'),
  toastLiveExample2 = document.getElementById('borderedToast1');
toastTrigger2 &&
  toastLiveExample2 &&
  toastTrigger2.addEventListener('click', function () {
    new bootstrap.Toast(toastLiveExample2).show();
  });
var toastTrigger3 = document.getElementById('borderedToast2Btn'),
  toastLiveExample3 = document.getElementById('borderedToast2');
toastTrigger3 &&
  toastLiveExample3 &&
  toastTrigger3.addEventListener('click', function () {
    new bootstrap.Toast(toastLiveExample3).show();
  });
var toastTrigger4 = document.getElementById('borderedTost3Btn'),
  toastLiveExample4 = document.getElementById('borderedTost3');
toastTrigger4 &&
  toastLiveExample4 &&
  toastTrigger4.addEventListener('click', function () {
    new bootstrap.Toast(toastLiveExample4).show();
  });
var toastTrigger5 = document.getElementById('borderedToast4Btn'),
  toastLiveExample5 = document.getElementById('borderedToast4');
toastTrigger5 &&
  toastLiveExample5 &&
  toastTrigger5.addEventListener('click', function () {
    new bootstrap.Toast(toastLiveExample5).show();
  }),
  (toastPlacement = document.getElementById('toastPlacement')),
  toastPlacement &&
    document
      .getElementById('selectToastPlacement')
      .addEventListener('change', function () {
        toastPlacement.dataset.originalClass ||
          (toastPlacement.dataset.originalClass = toastPlacement.className),
          (toastPlacement.className =
            toastPlacement.dataset.originalClass + ' ' + this.value);
      }),
  Array.from(document.querySelectorAll('.bd-example .toast')).forEach(function (
    t
  ) {
    new bootstrap.Toast(t, { autohide: !1 }).show();
  });

document.addEventListener('DOMContentLoaded', function () {
  var toastTrigger = document.querySelector('button[data-toast]');
  var toastLiveExample = document.getElementById('liveToast');

  if (toastTrigger && toastLiveExample) {
    toastTrigger.addEventListener('click', function () {
      var toast = new bootstrap.Toast(toastLiveExample);
      toast.show();
    });
  }
});