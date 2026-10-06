Pod::Spec.new do |s|
  s.name           = 'StemDsp'
  s.version        = '1.0.0'
  s.summary        = 'STFT / iSTFT htdemucs avec Accelerate'
  s.description    = 'Pré et post-traitement de la séparation de pistes, en natif.'
  s.author         = ''
  s.homepage       = 'https://github.com/jmetrorun-wq/stem-test'
  s.license        = 'MIT'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'Accelerate', 'AVFoundation'

  # Optimisé même dans les builds Debug (profil EAS development) : sans
  # optimisation, ces boucles Swift sont >100x plus lentes (9 s par tranche
  # au lieu de 76 ms, mesuré sur Mac), ce qui annulait le gain sur iPhone.
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_OPTIMIZATION_LEVEL' => '-O',
    'SWIFT_COMPILATION_MODE' => 'wholemodule',
    'GCC_OPTIMIZATION_LEVEL' => '3',
  }

  s.source_files = '**/*.{h,m,mm,swift}'
end
